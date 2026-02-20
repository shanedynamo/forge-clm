"""
Maps extracted entities to contract record fields.

Uses surrounding text context (100-char window) to disambiguate which
database field a DOLLAR_AMOUNT or DATE entity belongs to.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from forge_nlp.extractors.rule_based import EntityAnnotation


# ─── Context keywords for disambiguation ──────────────────────────────

_CEILING_KEYWORDS = re.compile(
    r"ceil|total\s+(?:contract\s+)?value|maximum|not[- ]to[- ]exceed|NTE|estimated\s+cost",
    re.IGNORECASE,
)
_FUNDED_KEYWORDS = re.compile(
    r"fund(?:ed|ing)|obligat|current(?:ly)?\s+fund|allot",
    re.IGNORECASE,
)
_POP_START_KEYWORDS = re.compile(
    r"period\s+of\s+performance|effective\s+date|start(?:ing)?\s+date|commence|begin",
    re.IGNORECASE,
)
_POP_END_KEYWORDS = re.compile(
    r"end(?:ing)?\s+date|expir|through|completion|terminat",
    re.IGNORECASE,
)

_CONTEXT_WINDOW = 100  # chars before/after an entity to inspect


@dataclass
class ContractMetadata:
    """Extracted metadata fields that map to the contracts table."""

    contract_number: str | None = None
    ceiling_value: str | None = None
    funded_value: str | None = None
    pop_start: str | None = None  # ISO date string
    pop_end: str | None = None  # ISO date string
    naics_code: str | None = None
    psc_code: str | None = None
    security_level: str | None = None
    cage_code: str | None = None
    uei_number: str | None = None
    contracting_officer_name: str | None = None
    far_clauses: list[str] = field(default_factory=list)
    dfars_clauses: list[str] = field(default_factory=list)


def _get_context(text: str, entity: EntityAnnotation, window: int = _CONTEXT_WINDOW) -> str:
    """Return the text window surrounding an entity (lowercased)."""
    start = max(0, entity.start_char - window)
    end = min(len(text), entity.end_char + window)
    return text[start:end].lower()


def map_entities_to_metadata(
    text: str,
    entities: list[EntityAnnotation],
) -> ContractMetadata:
    """Map a list of extracted entities to contract metadata fields.

    Args:
        text: The full document text (used for context windows).
        entities: All extracted entities from both rule-based and NER.

    Returns:
        A ContractMetadata with fields populated from the entities.
    """
    meta = ContractMetadata()

    dollar_entities: list[EntityAnnotation] = []
    date_entities: list[EntityAnnotation] = []

    for ent in entities:
        etype = ent.entity_type

        if etype == "CONTRACT_NUMBER" and meta.contract_number is None:
            meta.contract_number = ent.entity_value

        elif etype == "NAICS_CODE" and meta.naics_code is None:
            meta.naics_code = ent.entity_value

        elif etype == "PSC_CODE" and meta.psc_code is None:
            meta.psc_code = ent.entity_value

        elif etype == "CAGE_CODE" and meta.cage_code is None:
            meta.cage_code = ent.entity_value

        elif etype == "UEI_NUMBER" and meta.uei_number is None:
            meta.uei_number = ent.entity_value

        elif etype == "SECURITY_LEVEL" and meta.security_level is None:
            meta.security_level = ent.entity_value.upper().replace(" ", "_")

        elif etype == "FAR_CLAUSE":
            meta.far_clauses.append(ent.entity_value)

        elif etype == "DFARS_CLAUSE":
            meta.dfars_clauses.append(ent.entity_value)

        elif etype == "CONTRACTING_OFFICER" and meta.contracting_officer_name is None:
            meta.contracting_officer_name = ent.entity_value

        elif etype == "DOLLAR_AMOUNT":
            dollar_entities.append(ent)

        elif etype == "DATE":
            date_entities.append(ent)

        elif etype == "POP_RANGE":
            # POP_RANGE entities carry start/end in metadata
            if ent.metadata.get("start_date") and meta.pop_start is None:
                meta.pop_start = ent.metadata["start_date"]
            if ent.metadata.get("end_date") and meta.pop_end is None:
                meta.pop_end = ent.metadata["end_date"]

    # Disambiguate dollar amounts using context
    for dent in dollar_entities:
        ctx = _get_context(text, dent)
        if meta.ceiling_value is None and _CEILING_KEYWORDS.search(ctx):
            normalized = ent.metadata.get("normalized") if hasattr(dent, "metadata") else None
            meta.ceiling_value = dent.metadata.get("normalized", dent.entity_value)
        elif meta.funded_value is None and _FUNDED_KEYWORDS.search(ctx):
            meta.funded_value = dent.metadata.get("normalized", dent.entity_value)
        elif meta.ceiling_value is None:
            # Default: first dollar amount without clear context goes to ceiling
            meta.ceiling_value = dent.metadata.get("normalized", dent.entity_value)

    # Disambiguate dates using context (only if POP_RANGE didn't already set them)
    for dent in date_entities:
        ctx = _get_context(text, dent)
        iso = dent.metadata.get("iso_date", dent.entity_value)
        if meta.pop_start is None and _POP_START_KEYWORDS.search(ctx):
            meta.pop_start = iso
        elif meta.pop_end is None and _POP_END_KEYWORDS.search(ctx):
            meta.pop_end = iso

    return meta
