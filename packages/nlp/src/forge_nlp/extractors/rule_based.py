"""
Rule-based entity extraction for federal contract documents.

Deterministic regex-based extractors for FAR/DFARS clauses, contract numbers,
NAICS/PSC/CAGE codes, dollar amounts, dates, security levels, and more.
"""

from __future__ import annotations

import re
from calendar import monthrange
from dataclasses import dataclass, field
from datetime import date, datetime

# ─── Entity annotation ───────────────────────────────────────────────


@dataclass
class EntityAnnotation:
    entity_type: str
    entity_value: str
    start_char: int
    end_char: int
    confidence: float = 1.0
    metadata: dict = field(default_factory=dict)


# ─── Month name lookup ───────────────────────────────────────────────

_MONTH_MAP: dict[str, int] = {
    "january": 1, "jan": 1,
    "february": 2, "feb": 2,
    "march": 3, "mar": 3,
    "april": 4, "apr": 4,
    "may": 5,
    "june": 6, "jun": 6,
    "july": 7, "jul": 7,
    "august": 8, "aug": 8,
    "september": 9, "sep": 9, "sept": 9,
    "october": 10, "oct": 10,
    "november": 11, "nov": 11,
    "december": 12, "dec": 12,
}

# ─── Multiplier abbreviations ────────────────────────────────────────

_MULT_MAP: dict[str, float] = {
    "k": 1_000,
    "K": 1_000,
    "m": 1_000_000,
    "M": 1_000_000,
    "b": 1_000_000_000,
    "B": 1_000_000_000,
    "t": 1_000_000_000_000,
    "T": 1_000_000_000_000,
}


# ═══════════════════════════════════════════════════════════════════════
# 1. FAR_CLAUSE
# ═══════════════════════════════════════════════════════════════════════

_FAR_CLAUSE_RE = re.compile(
    r"""
    \b
    (52\.\d{3}-\d{1,4})       # base: 52.xxx-y
    (?:\s*\(Dev\))?            # optional (Dev)
    (?:\s+Alt(?:ernate)?\s+    # optional Alt/Alternate
       ([IVX]+|\d+)           #   roman or arabic numeral
    )?
    """,
    re.VERBOSE,
)


def extract_far_clauses(text: str) -> list[EntityAnnotation]:
    results: list[EntityAnnotation] = []
    for m in _FAR_CLAUSE_RE.finditer(text):
        base = m.group(1)
        full = m.group(0).strip()
        meta: dict = {"clause_base": base}
        if "(Dev)" in full:
            meta["deviation"] = True
        alt = m.group(2)
        if alt:
            meta["alternate"] = alt
        results.append(EntityAnnotation(
            entity_type="FAR_CLAUSE",
            entity_value=full,
            start_char=m.start(),
            end_char=m.start() + len(full),
            metadata=meta,
        ))
    return results


# ═══════════════════════════════════════════════════════════════════════
# 2. DFARS_CLAUSE
# ═══════════════════════════════════════════════════════════════════════

_DFARS_CLAUSE_RE = re.compile(
    r"""
    \b
    (252\.\d{3}-\d{4})         # base: 252.xxx-yyyy
    (?:\s*\(Dev\))?            # optional (Dev)
    (?:\s+Alt(?:ernate)?\s+    # optional Alt/Alternate
       ([IVX]+|\d+)           #   roman or arabic numeral
    )?
    """,
    re.VERBOSE,
)


def extract_dfars_clauses(text: str) -> list[EntityAnnotation]:
    results: list[EntityAnnotation] = []
    for m in _DFARS_CLAUSE_RE.finditer(text):
        base = m.group(1)
        full = m.group(0).strip()
        meta: dict = {"clause_base": base}
        if "(Dev)" in full:
            meta["deviation"] = True
        alt = m.group(2)
        if alt:
            meta["alternate"] = alt
        results.append(EntityAnnotation(
            entity_type="DFARS_CLAUSE",
            entity_value=full,
            start_char=m.start(),
            end_char=m.start() + len(full),
            metadata=meta,
        ))
    return results


# ═══════════════════════════════════════════════════════════════════════
# 3. CONTRACT_NUMBER
# ═══════════════════════════════════════════════════════════════════════

_CONTRACT_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("Army", re.compile(r"\bW911[A-Z]{2}-\d{2}-[A-Z]-\d{4}\b")),
    ("Navy", re.compile(r"\bN\d{5}-\d{2}-[A-Z]-\d{4}\b")),
    ("Air Force", re.compile(r"\bFA\d{4}-\d{2}-[A-Z]-\d{4}\b")),
    ("GSA", re.compile(r"\bGS-\d{2}[A-Z]-\d{4}[A-Z]\b")),
    ("Generic", re.compile(r"\b[A-Z][A-Z0-9]{5,}-\d{2}-[A-Z]-\d{4}\b")),
]


def extract_contract_numbers(text: str) -> list[EntityAnnotation]:
    results: list[EntityAnnotation] = []
    seen_spans: set[tuple[int, int]] = set()
    for agency, pattern in _CONTRACT_PATTERNS:
        for m in pattern.finditer(text):
            span = (m.start(), m.end())
            # Avoid duplicate from Generic matching a specific pattern
            if span in seen_spans:
                continue
            # Check if this span overlaps with an already-seen span
            overlaps = False
            for s_start, s_end in seen_spans:
                if m.start() < s_end and m.end() > s_start:
                    overlaps = True
                    break
            if overlaps:
                continue
            seen_spans.add(span)
            results.append(EntityAnnotation(
                entity_type="CONTRACT_NUMBER",
                entity_value=m.group(0),
                start_char=m.start(),
                end_char=m.end(),
                metadata={"agency_format": agency},
            ))
    return results


# ═══════════════════════════════════════════════════════════════════════
# 4. NAICS_CODE
# ═══════════════════════════════════════════════════════════════════════

# Match 6-digit numbers that look like NAICS codes, not phone/zip/other numbers.
# Require context: preceded by "NAICS", a field label, or word boundary with no
# adjacent digits that would indicate a longer number.
_NAICS_RE = re.compile(
    r"""
    (?:
        (?:NAICS(?:\s+(?:Code|code))?[\s:]+)  # "NAICS:" or "NAICS Code:"
        (\d{6})
    |
        (?<=\b)                                 # word boundary
        (\d{6})
        (?=\b)
    )
    """,
    re.VERBOSE,
)

# Negative context: preceded or followed by more digits, or in phone-like patterns
_PHONE_RE = re.compile(r"\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}")
_ZIP_PLUS4_RE = re.compile(r"\d{5}-\d{4}")


def extract_naics_codes(text: str) -> list[EntityAnnotation]:
    results: list[EntityAnnotation] = []
    for m in _NAICS_RE.finditer(text):
        code = m.group(1) or m.group(2)
        if not code:
            continue

        # Find the actual position of the 6-digit code within the match
        code_start = m.start(1) if m.group(1) else m.start(2)
        code_end = code_start + 6

        # Skip if surrounded by more digits (part of a longer number)
        if code_start > 0 and text[code_start - 1].isdigit():
            continue
        if code_end < len(text) and text[code_end].isdigit():
            continue

        # Skip phone numbers
        is_phone = False
        for pm in _PHONE_RE.finditer(text):
            if pm.start() <= code_start < pm.end():
                is_phone = True
                break
        if is_phone:
            continue

        # Skip zip+4 patterns
        is_zip = False
        for zm in _ZIP_PLUS4_RE.finditer(text):
            if zm.start() <= code_start < zm.end():
                is_zip = True
                break
        if is_zip:
            continue

        # Determine if it has NAICS context label (higher confidence in labeling)
        has_label = bool(m.group(1))
        if not has_label:
            # For unlabeled 6-digit numbers, require NAICS-like range (111110-928120)
            first_digit = int(code[0])
            if first_digit < 1 or first_digit > 9:
                continue
            # Check proximity for "NAICS" mention within 100 chars
            context_window = text[max(0, code_start - 100):code_start]
            if "NAICS" not in context_window.upper():
                continue

        results.append(EntityAnnotation(
            entity_type="NAICS_CODE",
            entity_value=code,
            start_char=code_start,
            end_char=code_end,
            metadata={"labeled": has_label},
        ))
    return results


# ═══════════════════════════════════════════════════════════════════════
# 5. PSC_CODE
# ═══════════════════════════════════════════════════════════════════════

_PSC_RE = re.compile(
    r"""
    (?:PSC\s*(?:Code)?|Product\s+Service\s+Code|Product/Service\s+Code)
    [\s:]+
    ([A-Z][A-Z0-9]{3})     # PSC codes start with a letter
    \b
    """,
    re.VERBOSE | re.IGNORECASE,
)


def extract_psc_codes(text: str) -> list[EntityAnnotation]:
    results: list[EntityAnnotation] = []
    for m in _PSC_RE.finditer(text):
        code = m.group(1)
        results.append(EntityAnnotation(
            entity_type="PSC_CODE",
            entity_value=code,
            start_char=m.start(1),
            end_char=m.end(1),
            metadata={},
        ))
    return results


# ═══════════════════════════════════════════════════════════════════════
# 6. CAGE_CODE
# ═══════════════════════════════════════════════════════════════════════

_CAGE_RE = re.compile(
    r"""
    (?:CAGE\s+Code|CAGE\s*:)  # require "CAGE Code" or "CAGE:"
    [\s:]*                     # optional separator (colon/space)
    ([A-Z0-9]{5})
    \b
    """,
    re.VERBOSE | re.IGNORECASE,
)


def extract_cage_codes(text: str) -> list[EntityAnnotation]:
    results: list[EntityAnnotation] = []
    for m in _CAGE_RE.finditer(text):
        code = m.group(1)
        results.append(EntityAnnotation(
            entity_type="CAGE_CODE",
            entity_value=code,
            start_char=m.start(1),
            end_char=m.end(1),
            metadata={},
        ))
    return results


# ═══════════════════════════════════════════════════════════════════════
# 7. UEI_NUMBER
# ═══════════════════════════════════════════════════════════════════════

_UEI_RE = re.compile(
    r"""
    (?:UEI|Unique\s+Entity\s+(?:ID|Identifier))
    [\s:]+
    ([A-Z0-9]{12})
    \b
    """,
    re.VERBOSE | re.IGNORECASE,
)


def extract_uei_numbers(text: str) -> list[EntityAnnotation]:
    results: list[EntityAnnotation] = []
    for m in _UEI_RE.finditer(text):
        code = m.group(1)
        results.append(EntityAnnotation(
            entity_type="UEI_NUMBER",
            entity_value=code,
            start_char=m.start(1),
            end_char=m.end(1),
            metadata={},
        ))
    return results


# ═══════════════════════════════════════════════════════════════════════
# 8. DOLLAR_AMOUNT
# ═══════════════════════════════════════════════════════════════════════

_DOLLAR_RE = re.compile(
    r"""
    (?:
        \$\s*                                   # $ prefix
        ([\d,]+(?:\.\d+)?)                      # digits with optional decimal
        \s*([kKmMbBtT](?:illion|illion)?)?\b    # optional multiplier
    |
        USD\s+                                  # "USD " prefix
        ([\d,]+(?:\.\d+)?)                      # digits
        \s*([kKmMbBtT](?:illion|illion)?)?\b    # optional multiplier
    )
    """,
    re.VERBOSE,
)


def _normalize_dollar(raw_digits: str, suffix: str | None) -> float:
    """Convert raw dollar text to a numeric value."""
    cleaned = raw_digits.replace(",", "")
    value = float(cleaned)
    if suffix:
        key = suffix[0]  # first char: k, M, B, etc.
        mult = _MULT_MAP.get(key, 1)
        value *= mult
    return value


def extract_dollar_amounts(text: str) -> list[EntityAnnotation]:
    results: list[EntityAnnotation] = []
    for m in _DOLLAR_RE.finditer(text):
        raw_digits = m.group(1) or m.group(3)
        suffix = m.group(2) or m.group(4)
        if not raw_digits:
            continue
        normalized = _normalize_dollar(raw_digits, suffix)
        full = m.group(0).strip()
        results.append(EntityAnnotation(
            entity_type="DOLLAR_AMOUNT",
            entity_value=full,
            start_char=m.start(),
            end_char=m.start() + len(full),
            metadata={
                "normalized_value": normalized,
                "raw_text": full,
            },
        ))
    return results


# ═══════════════════════════════════════════════════════════════════════
# 9. DATE
# ═══════════════════════════════════════════════════════════════════════

_MONTH_NAMES = "|".join(_MONTH_MAP.keys())

# "01 January 2026" or "1 January 2026"
_DATE_DMY_RE = re.compile(
    rf"\b(\d{{1,2}})\s+({_MONTH_NAMES})\s+(\d{{4}})\b",
    re.IGNORECASE,
)

# "January 1, 2026" or "January 01, 2026"
_DATE_MDY_RE = re.compile(
    rf"\b({_MONTH_NAMES})\s+(\d{{1,2}}),?\s+(\d{{4}})\b",
    re.IGNORECASE,
)

# ISO: 2026-01-01
_DATE_ISO_RE = re.compile(
    r"\b(\d{4})-(\d{2})-(\d{2})\b",
)

# US: 01/01/2026 or 1/1/2026
_DATE_US_RE = re.compile(
    r"\b(\d{1,2})/(\d{1,2})/(\d{4})\b",
)


def _validate_date(year: int, month: int, day: int) -> bool:
    """Check if y/m/d forms a valid date."""
    if month < 1 or month > 12:
        return False
    _, max_day = monthrange(year, month)
    return 1 <= day <= max_day


def _to_iso(year: int, month: int, day: int) -> str:
    return f"{year:04d}-{month:02d}-{day:02d}"


def extract_dates(text: str) -> list[EntityAnnotation]:
    results: list[EntityAnnotation] = []
    seen_spans: set[tuple[int, int]] = set()

    # DMY: "01 January 2026"
    for m in _DATE_DMY_RE.finditer(text):
        day = int(m.group(1))
        month = _MONTH_MAP[m.group(2).lower()]
        year = int(m.group(3))
        if not _validate_date(year, month, day):
            continue
        span = (m.start(), m.end())
        seen_spans.add(span)
        results.append(EntityAnnotation(
            entity_type="DATE",
            entity_value=m.group(0),
            start_char=m.start(),
            end_char=m.end(),
            metadata={"iso_date": _to_iso(year, month, day)},
        ))

    # MDY: "January 1, 2026"
    for m in _DATE_MDY_RE.finditer(text):
        month = _MONTH_MAP[m.group(1).lower()]
        day = int(m.group(2))
        year = int(m.group(3))
        if not _validate_date(year, month, day):
            continue
        span = (m.start(), m.end())
        if any(s[0] <= span[0] < s[1] for s in seen_spans):
            continue
        seen_spans.add(span)
        results.append(EntityAnnotation(
            entity_type="DATE",
            entity_value=m.group(0),
            start_char=m.start(),
            end_char=m.end(),
            metadata={"iso_date": _to_iso(year, month, day)},
        ))

    # ISO: 2026-01-01
    for m in _DATE_ISO_RE.finditer(text):
        year, month, day = int(m.group(1)), int(m.group(2)), int(m.group(3))
        if not _validate_date(year, month, day):
            continue
        span = (m.start(), m.end())
        if any(s[0] <= span[0] < s[1] for s in seen_spans):
            continue
        seen_spans.add(span)
        results.append(EntityAnnotation(
            entity_type="DATE",
            entity_value=m.group(0),
            start_char=m.start(),
            end_char=m.end(),
            metadata={"iso_date": _to_iso(year, month, day)},
        ))

    # US: 01/01/2026
    for m in _DATE_US_RE.finditer(text):
        month, day, year = int(m.group(1)), int(m.group(2)), int(m.group(3))
        if not _validate_date(year, month, day):
            continue
        span = (m.start(), m.end())
        if any(s[0] <= span[0] < s[1] for s in seen_spans):
            continue
        seen_spans.add(span)
        results.append(EntityAnnotation(
            entity_type="DATE",
            entity_value=m.group(0),
            start_char=m.start(),
            end_char=m.end(),
            metadata={"iso_date": _to_iso(year, month, day)},
        ))

    return results


# ═══════════════════════════════════════════════════════════════════════
# 10. POP_RANGE
# ═══════════════════════════════════════════════════════════════════════

# Build a month-name alternation for POP range dates
_MN = (
    r"(?:January|February|March|April|May|June|July|August|September|October|November|December"
    r"|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)"
)

# Date fragment: "01 Feb 2025" or "February 1, 2025" or "2025-02-01" or "02/01/2025"
_DATE_FRAG = rf"(?:\d{{1,2}}\s+{_MN}\s+\d{{4}}|{_MN}\s+\d{{1,2}},?\s+\d{{4}}|\d{{4}}-\d{{2}}-\d{{2}}|\d{{1,2}}/\d{{1,2}}/\d{{4}})"

_POP_RE = re.compile(
    rf"""
    (?:
        (?:period\s+of\s+performance|POP)
        [:\s]*
    )?
    ({_DATE_FRAG})                        # start date
    \s+(?:through|thru|to|-|–|—)\s+       # separator
    ({_DATE_FRAG})                        # end date
    """,
    re.VERBOSE | re.IGNORECASE,
)

# Also match "from X to Y"
_POP_FROM_RE = re.compile(
    rf"""
    \bfrom\s+
    ({_DATE_FRAG})
    \s+to\s+
    ({_DATE_FRAG})
    """,
    re.VERBOSE | re.IGNORECASE,
)


def _parse_date_fragment(frag: str) -> str | None:
    """Parse a date fragment and return ISO string, or None if invalid."""
    frag = frag.strip()

    # Try DMY: "01 Feb 2025"
    m = _DATE_DMY_RE.match(frag)
    if m:
        day = int(m.group(1))
        month = _MONTH_MAP[m.group(2).lower()]
        year = int(m.group(3))
        if _validate_date(year, month, day):
            return _to_iso(year, month, day)

    # Try MDY: "February 1, 2025"
    m = _DATE_MDY_RE.match(frag)
    if m:
        month = _MONTH_MAP[m.group(1).lower()]
        day = int(m.group(2))
        year = int(m.group(3))
        if _validate_date(year, month, day):
            return _to_iso(year, month, day)

    # Try ISO: "2025-02-01"
    m = _DATE_ISO_RE.match(frag)
    if m:
        year, month, day = int(m.group(1)), int(m.group(2)), int(m.group(3))
        if _validate_date(year, month, day):
            return _to_iso(year, month, day)

    # Try US: "02/01/2025"
    m = _DATE_US_RE.match(frag)
    if m:
        month, day, year = int(m.group(1)), int(m.group(2)), int(m.group(3))
        if _validate_date(year, month, day):
            return _to_iso(year, month, day)

    return None


def _spans_overlap(a: tuple[int, int], b: tuple[int, int]) -> bool:
    return a[0] < b[1] and b[0] < a[1]


def extract_pop_ranges(text: str) -> list[EntityAnnotation]:
    # Collect all candidate matches, preferring longer (more specific) matches
    candidates: list[tuple[int, int, str, str, str]] = []  # start, end, value, start_iso, end_iso

    for pattern in (_POP_FROM_RE, _POP_RE):
        for m in pattern.finditer(text):
            start_iso = _parse_date_fragment(m.group(1))
            end_iso = _parse_date_fragment(m.group(2))
            if not start_iso or not end_iso:
                continue
            candidates.append((m.start(), m.end(), m.group(0).strip(), start_iso, end_iso))

    # Sort by span length descending (prefer longer match), then by start_char
    candidates.sort(key=lambda c: (-(c[1] - c[0]), c[0]))

    results: list[EntityAnnotation] = []
    taken_spans: list[tuple[int, int]] = []

    for start, end, value, start_iso, end_iso in candidates:
        span = (start, end)
        if any(_spans_overlap(span, s) for s in taken_spans):
            continue
        taken_spans.append(span)
        results.append(EntityAnnotation(
            entity_type="POP_RANGE",
            entity_value=value,
            start_char=start,
            end_char=end,
            metadata={
                "start_date": start_iso,
                "end_date": end_iso,
            },
        ))

    results.sort(key=lambda a: a.start_char)
    return results


# ═══════════════════════════════════════════════════════════════════════
# 11. SECURITY_LEVEL
# ═══════════════════════════════════════════════════════════════════════

_SECURITY_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("TS/SCI", re.compile(r"\bTS/SCI\b")),
    ("TOP_SECRET", re.compile(r"\bTOP\s+SECRET\b", re.IGNORECASE)),
    ("SECRET", re.compile(r"\bSECRET\b(?!\s+(?:service|sauce|key|weapon))", re.IGNORECASE)),
    ("CUI", re.compile(
        r"\bCUI\b|\bControlled\s+Unclassified\s+Information\b",
        re.IGNORECASE,
    )),
    ("FOUO", re.compile(r"\bFOUO\b|\bFor\s+Official\s+Use\s+Only\b", re.IGNORECASE)),
    ("UNCLASSIFIED", re.compile(r"\bUNCLASSIFIED\b", re.IGNORECASE)),
]


def extract_security_levels(text: str) -> list[EntityAnnotation]:
    results: list[EntityAnnotation] = []
    seen_spans: set[tuple[int, int]] = set()
    for level, pattern in _SECURITY_PATTERNS:
        for m in pattern.finditer(text):
            span = (m.start(), m.end())
            # Skip if this overlaps with a more specific match
            overlaps = False
            for s_start, s_end in seen_spans:
                if m.start() < s_end and m.end() > s_start:
                    overlaps = True
                    break
            if overlaps:
                continue
            seen_spans.add(span)
            results.append(EntityAnnotation(
                entity_type="SECURITY_LEVEL",
                entity_value=level,
                start_char=m.start(),
                end_char=m.end(),
                metadata={"raw_text": m.group(0)},
            ))
    return results


# ═══════════════════════════════════════════════════════════════════════
# 12. CLIN
# ═══════════════════════════════════════════════════════════════════════

_CLIN_RE = re.compile(
    r"\bCLIN\s+(\d{4}[A-Z]{0,2})\b",
    re.IGNORECASE,
)


def extract_clins(text: str) -> list[EntityAnnotation]:
    results: list[EntityAnnotation] = []
    for m in _CLIN_RE.finditer(text):
        clin_id = m.group(1)
        results.append(EntityAnnotation(
            entity_type="CLIN",
            entity_value=clin_id,
            start_char=m.start(),
            end_char=m.end(),
            metadata={},
        ))
    return results


# ═══════════════════════════════════════════════════════════════════════
# Orchestrator
# ═══════════════════════════════════════════════════════════════════════

_ALL_EXTRACTORS = [
    extract_far_clauses,
    extract_dfars_clauses,
    extract_contract_numbers,
    extract_naics_codes,
    extract_psc_codes,
    extract_cage_codes,
    extract_uei_numbers,
    extract_dollar_amounts,
    extract_dates,
    extract_pop_ranges,
    extract_security_levels,
    extract_clins,
]


def extract_all_entities(text: str) -> list[EntityAnnotation]:
    """
    Run all extractors and return deduplicated, sorted results.

    Results are sorted by start_char, then by entity_type for stable ordering.
    Duplicate annotations (same type, same span) are removed.
    """
    all_results: list[EntityAnnotation] = []
    for extractor in _ALL_EXTRACTORS:
        all_results.extend(extractor(text))

    # Deduplicate: same entity_type + overlapping span → keep first
    deduped: list[EntityAnnotation] = []
    seen: set[tuple[str, int, int]] = set()
    for ann in sorted(all_results, key=lambda a: (a.start_char, a.entity_type)):
        key = (ann.entity_type, ann.start_char, ann.end_char)
        if key in seen:
            continue
        seen.add(key)
        deduped.append(ann)

    return deduped
