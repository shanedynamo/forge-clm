"""
Document chunking for federal contracts.

Splits contracts at natural clause boundaries following the Uniform Contract
Format (UCF) rather than arbitrary token windows, producing chunks sized for
BERT-512 context windows.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from enum import Enum


# ─── Constants ────────────────────────────────────────────────────────

_TARGET_TOKENS = 500
_MAX_TOKENS = 600
_OVERLAP_TOKENS = 50

# Rough approximation: 1 token ≈ 4 characters (English text average).
# We use word-splitting for actual counts but this helps nowhere else.
_CHARS_PER_TOKEN_APPROX = 4


# ─── UCF Section types ───────────────────────────────────────────────

class SectionType(str, Enum):
    SECTION_A = "SECTION_A"
    SECTION_B = "SECTION_B"
    SECTION_C = "SECTION_C"
    SECTION_D = "SECTION_D"
    SECTION_E = "SECTION_E"
    SECTION_F = "SECTION_F"
    SECTION_G = "SECTION_G"
    SECTION_H = "SECTION_H"
    SECTION_I = "SECTION_I"
    SECTION_J = "SECTION_J"
    SECTION_K = "SECTION_K"
    SECTION_L = "SECTION_L"
    SECTION_M = "SECTION_M"
    OTHER = "OTHER"


# Map single letter to SectionType
_LETTER_TO_SECTION: dict[str, SectionType] = {
    chr(c): SectionType(f"SECTION_{chr(c)}") for c in range(ord("A"), ord("N"))
}


# ─── Data classes ─────────────────────────────────────────────────────

@dataclass
class DetectedSection:
    """A section detected in the document."""
    section_type: SectionType
    start_char: int
    end_char: int
    header_text: str = ""


@dataclass
class DocumentChunk:
    """A single chunk of a contract document."""
    chunk_text: str
    section_type: str  # SectionType value string
    clause_number: str | None
    chunk_index: int
    metadata: dict = field(default_factory=dict)


# ─── Token counting ──────────────────────────────────────────────────

def _word_count(text: str) -> int:
    """Count words (our proxy for token count)."""
    return len(text.split())


def _has_table(text: str) -> bool:
    """Heuristic: text has table-like content (pipes, tab-aligned columns)."""
    return bool(re.search(r"\|.*\||\t{2,}", text))


def _has_list(text: str) -> bool:
    """Heuristic: text has list items."""
    return bool(re.search(r"(?m)^\s*(?:[(\[][a-z0-9]+[)\]]|\d+\.|[-•*])\s+", text))


# ═══════════════════════════════════════════════════════════════════════
# SectionDetector
# ═══════════════════════════════════════════════════════════════════════

# Patterns for UCF section headers — ordered by specificity.
# Group 1 captures the section letter.

_SECTION_PATTERNS: list[re.Pattern[str]] = [
    # "SECTION A", "Section A -", "SECTION A:", "SECTION A –"
    re.compile(
        r"(?m)^[ \t]*SECTION\s+([A-M])\b[\s\-–—:]*",
        re.IGNORECASE,
    ),
    # "A. SUPPLIES OR SERVICES", "B. SUPPLIES OR SERVICES AND PRICES"
    # A letter at the start of a line followed by dot + all-caps title
    re.compile(
        r"(?m)^[ \t]*([A-M])\.\s+[A-Z][A-Z /,()]+",
    ),
    # "PART I", "PART II" etc. — these map to groups of sections
    re.compile(
        r"(?m)^[ \t]*PART\s+(I{1,3}V?|IV|V)\b",
        re.IGNORECASE,
    ),
    # "ARTICLE 1", "ARTICLE 2" etc.
    re.compile(
        r"(?m)^[ \t]*ARTICLE\s+(\d+)\b",
        re.IGNORECASE,
    ),
]

# PART roman numerals → first section letter in that part
_PART_MAP: dict[str, str] = {
    "I": "A",
    "II": "B",
    "III": "H",
    "IV": "K",
}


class SectionDetector:
    """Detect UCF section boundaries in a federal contract document."""

    def detect(self, text: str) -> list[DetectedSection]:
        """Return detected sections sorted by start_char."""
        raw: list[tuple[SectionType, int, str]] = []  # type, start, header_text

        for pattern in _SECTION_PATTERNS:
            for m in pattern.finditer(text):
                captured = m.group(1).upper()
                section_type: SectionType | None = None

                # Direct letter match
                if captured in _LETTER_TO_SECTION:
                    section_type = _LETTER_TO_SECTION[captured]
                # PART roman numeral
                elif captured in _PART_MAP:
                    letter = _PART_MAP[captured]
                    section_type = _LETTER_TO_SECTION[letter]
                # ARTICLE number — map to OTHER
                elif captured.isdigit():
                    section_type = SectionType.OTHER
                else:
                    continue

                header_line_end = text.find("\n", m.start())
                if header_line_end == -1:
                    header_line_end = len(text)
                header_text = text[m.start():header_line_end].strip()
                raw.append((section_type, m.start(), header_text))

        if not raw:
            return []

        # Deduplicate: if we see the same section type from multiple patterns,
        # keep the one that appears first in the text.
        seen_types: dict[SectionType, int] = {}
        deduped: list[tuple[SectionType, int, str]] = []
        # Sort by position first
        raw.sort(key=lambda x: x[1])
        for stype, start, header in raw:
            if stype in seen_types:
                # Skip duplicate
                continue
            seen_types[stype] = start
            deduped.append((stype, start, header))

        # Sort by start_char
        deduped.sort(key=lambda x: x[1])

        # Compute end_char: each section runs until the start of the next
        sections: list[DetectedSection] = []
        for i, (stype, start, header) in enumerate(deduped):
            if i + 1 < len(deduped):
                end = deduped[i + 1][1]
            else:
                end = len(text)
            sections.append(DetectedSection(
                section_type=stype,
                start_char=start,
                end_char=end,
                header_text=header,
            ))

        return sections


# ═══════════════════════════════════════════════════════════════════════
# ClauseChunker
# ═══════════════════════════════════════════════════════════════════════

# FAR/DFARS clause header pattern used to split Section I
_CLAUSE_HEADER_RE = re.compile(
    r"""
    (?m)                          # multiline
    ^[ \t]*                       # optional leading whitespace
    ((?:52|252)\.\d{3}-\d{1,4})   # clause number (FAR or DFARS)
    [ \t]+                        # space after number
    (.+)                          # clause title
    """,
    re.VERBOSE,
)


class ClauseChunker:
    """Chunk document text respecting clause and section boundaries."""

    def __init__(
        self,
        target_tokens: int = _TARGET_TOKENS,
        max_tokens: int = _MAX_TOKENS,
        overlap_tokens: int = _OVERLAP_TOKENS,
    ):
        self.target_tokens = target_tokens
        self.max_tokens = max_tokens
        self.overlap_tokens = overlap_tokens

    def chunk_document(
        self,
        text: str,
        sections: list[DetectedSection],
    ) -> list[DocumentChunk]:
        """Chunk the document using detected sections."""
        if not sections:
            # Fallback: treat entire document as OTHER, paragraph-chunk it
            return self._chunk_paragraphs(text, SectionType.OTHER, clause_number=None)

        chunks: list[DocumentChunk] = []
        for section in sections:
            section_text = text[section.start_char:section.end_char]
            if section.section_type == SectionType.SECTION_I:
                chunks.extend(self._chunk_section_i(section_text, section))
            else:
                chunks.extend(
                    self._chunk_paragraphs(
                        section_text,
                        section.section_type,
                        clause_number=None,
                    )
                )

        # Assign sequential chunk_index
        for i, chunk in enumerate(chunks):
            chunk.chunk_index = i

        return chunks

    # ─── Section I: clause-level chunking ────────────────────────────

    def _chunk_section_i(
        self,
        section_text: str,
        section: DetectedSection,
    ) -> list[DocumentChunk]:
        """Split Section I at individual clause boundaries."""
        # Find all clause headers within this section
        clause_matches = list(_CLAUSE_HEADER_RE.finditer(section_text))

        if not clause_matches:
            # No clause headers found — fallback to paragraph chunking
            return self._chunk_paragraphs(
                section_text, SectionType.SECTION_I, clause_number=None,
            )

        chunks: list[DocumentChunk] = []

        # Text before the first clause
        pre_text = section_text[:clause_matches[0].start()].strip()
        if pre_text:
            chunks.extend(
                self._chunk_paragraphs(
                    pre_text, SectionType.SECTION_I, clause_number=None,
                )
            )

        # Each clause: from this match to the next match (or end of section)
        for i, m in enumerate(clause_matches):
            clause_number = m.group(1)
            start = m.start()
            end = clause_matches[i + 1].start() if i + 1 < len(clause_matches) else len(section_text)
            clause_text = section_text[start:end].strip()

            if not clause_text:
                continue

            wc = _word_count(clause_text)
            if wc <= self.max_tokens:
                # Fits in one chunk
                chunks.append(self._make_chunk(
                    clause_text, SectionType.SECTION_I, clause_number,
                ))
            else:
                # Long clause — split at paragraph boundaries with overlap
                chunks.extend(
                    self._chunk_paragraphs(
                        clause_text, SectionType.SECTION_I,
                        clause_number=clause_number,
                    )
                )

        return chunks

    # ─── Paragraph-level chunking with overlap ───────────────────────

    def _chunk_paragraphs(
        self,
        text: str,
        section_type: SectionType,
        clause_number: str | None,
    ) -> list[DocumentChunk]:
        """Split text into chunks at paragraph boundaries, respecting token limits."""
        text = text.strip()
        if not text:
            return []

        # Split into paragraphs (double newline or single newline followed by indent)
        paragraphs = re.split(r"\n\s*\n|\n(?=[ \t]+\S)", text)
        paragraphs = [p.strip() for p in paragraphs if p.strip()]

        if not paragraphs:
            return []

        chunks: list[DocumentChunk] = []
        current_parts: list[str] = []
        current_wc = 0

        for para in paragraphs:
            para_wc = _word_count(para)

            # Single paragraph exceeds max — force-split it by sentences
            if para_wc > self.max_tokens:
                # Flush current accumulator
                if current_parts:
                    chunks.append(self._make_chunk(
                        "\n\n".join(current_parts), section_type, clause_number,
                    ))
                    current_parts = []
                    current_wc = 0
                # Split this giant paragraph
                chunks.extend(
                    self._force_split(para, section_type, clause_number)
                )
                continue

            # Would adding this paragraph exceed target?
            if current_wc + para_wc > self.target_tokens and current_parts:
                chunk_text = "\n\n".join(current_parts)
                chunks.append(self._make_chunk(
                    chunk_text, section_type, clause_number,
                ))
                # Overlap: keep the last paragraph(s) up to overlap_tokens
                overlap_parts: list[str] = []
                overlap_wc = 0
                for p in reversed(current_parts):
                    p_wc = _word_count(p)
                    if overlap_wc + p_wc > self.overlap_tokens:
                        break
                    overlap_parts.insert(0, p)
                    overlap_wc += p_wc
                current_parts = overlap_parts
                current_wc = overlap_wc

            current_parts.append(para)
            current_wc += para_wc

        # Flush remainder
        if current_parts:
            chunks.append(self._make_chunk(
                "\n\n".join(current_parts), section_type, clause_number,
            ))

        return chunks

    def _force_split(
        self,
        text: str,
        section_type: SectionType,
        clause_number: str | None,
    ) -> list[DocumentChunk]:
        """Force-split a large paragraph by sentences with overlap."""
        # Split by sentence-ending punctuation
        sentences = re.split(r"(?<=[.!?])\s+", text)
        chunks: list[DocumentChunk] = []
        current_parts: list[str] = []
        current_wc = 0

        for sent in sentences:
            sent_wc = _word_count(sent)
            if current_wc + sent_wc > self.target_tokens and current_parts:
                chunks.append(self._make_chunk(
                    " ".join(current_parts), section_type, clause_number,
                ))
                # Overlap: keep last sentences up to overlap_tokens
                overlap_parts: list[str] = []
                overlap_wc = 0
                for s in reversed(current_parts):
                    s_wc = _word_count(s)
                    if overlap_wc + s_wc > self.overlap_tokens:
                        break
                    overlap_parts.insert(0, s)
                    overlap_wc += s_wc
                current_parts = overlap_parts
                current_wc = overlap_wc
            current_parts.append(sent)
            current_wc += sent_wc

        if current_parts:
            chunks.append(self._make_chunk(
                " ".join(current_parts), section_type, clause_number,
            ))

        return chunks

    # ─── Chunk factory ───────────────────────────────────────────────

    @staticmethod
    def _make_chunk(
        text: str,
        section_type: SectionType,
        clause_number: str | None,
    ) -> DocumentChunk:
        """Create a DocumentChunk with computed metadata."""
        wc = _word_count(text)
        return DocumentChunk(
            chunk_text=text,
            section_type=section_type.value,
            clause_number=clause_number,
            chunk_index=0,  # Will be reassigned by caller
            metadata={
                "word_count": wc,
                "char_count": len(text),
                "has_table": _has_table(text),
                "has_list": _has_list(text),
                "parent_clause": clause_number,
            },
        )


# ═══════════════════════════════════════════════════════════════════════
# DocumentProcessor
# ═══════════════════════════════════════════════════════════════════════

class DocumentProcessor:
    """Orchestrates section detection and clause-aware chunking."""

    def __init__(
        self,
        target_tokens: int = _TARGET_TOKENS,
        max_tokens: int = _MAX_TOKENS,
        overlap_tokens: int = _OVERLAP_TOKENS,
    ):
        self.detector = SectionDetector()
        self.chunker = ClauseChunker(
            target_tokens=target_tokens,
            max_tokens=max_tokens,
            overlap_tokens=overlap_tokens,
        )

    def process(self, text: str, document_id: str = "") -> list[DocumentChunk]:
        """
        Process a full contract document into chunks.

        Args:
            text: Full document text.
            document_id: Optional identifier for the document.

        Returns:
            List of DocumentChunk with sequential chunk_index values.
        """
        text = text.strip()
        if not text:
            return []

        sections = self.detector.detect(text)

        if not sections:
            # No section headers found — fall back to paragraph chunking
            chunks = self.chunker.chunk_document(text, [])
        else:
            chunks = self.chunker.chunk_document(text, sections)

        # Add document_id to metadata
        for chunk in chunks:
            chunk.metadata["document_id"] = document_id

        return chunks
