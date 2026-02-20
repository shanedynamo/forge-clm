"""
Entity type definitions for the custom NER model.

These are Tier-2 entities that require contextual understanding beyond
what regex patterns can reliably capture.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum


class NerEntityType(str, Enum):
    """Custom NER entity types for federal contract analysis."""

    CONTRACTING_OFFICER = "CONTRACTING_OFFICER"
    CONTRACTOR_REP = "CONTRACTOR_REP"
    DELIVERABLE_DESC = "DELIVERABLE_DESC"
    SCOPE_DESCRIPTION = "SCOPE_DESCRIPTION"
    RISK_CLAUSE = "RISK_CLAUSE"
    IP_PROVISION = "IP_PROVISION"
    OPTION_DESCRIPTION = "OPTION_DESCRIPTION"
    FUNDING_TYPE = "FUNDING_TYPE"
    PROPERTY_ITEM = "PROPERTY_ITEM"
    SB_REQUIREMENT = "SB_REQUIREMENT"


@dataclass(frozen=True)
class EntityTypeInfo:
    """Metadata about a NER entity type."""

    label: str
    description: str
    examples: tuple[str, ...]


NER_ENTITY_TYPES: dict[NerEntityType, EntityTypeInfo] = {
    NerEntityType.CONTRACTING_OFFICER: EntityTypeInfo(
        label="CONTRACTING_OFFICER",
        description="Named individuals serving as CO, COR, or ACOR",
        examples=(
            "John Smith, Contracting Officer",
            "Jane Doe (COR)",
            "ACOR: Robert Johnson",
        ),
    ),
    NerEntityType.CONTRACTOR_REP: EntityTypeInfo(
        label="CONTRACTOR_REP",
        description="Named contractor representatives or program managers",
        examples=(
            "Contractor Program Manager: Sarah Williams",
            "Mr. James Brown, Contractor Representative",
        ),
    ),
    NerEntityType.DELIVERABLE_DESC: EntityTypeInfo(
        label="DELIVERABLE_DESC",
        description="Descriptions of deliverables and CDRLs",
        examples=(
            "Monthly Status Report (CDRL A001)",
            "Software Design Document",
            "Final Technical Report",
        ),
    ),
    NerEntityType.SCOPE_DESCRIPTION: EntityTypeInfo(
        label="SCOPE_DESCRIPTION",
        description="Work scope descriptions from SOW/PWS",
        examples=(
            "provide engineering support for satellite communications systems",
            "perform cybersecurity assessments of DoD networks",
        ),
    ),
    NerEntityType.RISK_CLAUSE: EntityTypeInfo(
        label="RISK_CLAUSE",
        description="Clauses flagged as posing contractual risk",
        examples=(
            "Limitation of Liability",
            "Termination for Default",
            "Liquidated Damages",
        ),
    ),
    NerEntityType.IP_PROVISION: EntityTypeInfo(
        label="IP_PROVISION",
        description="References to intellectual property and data rights",
        examples=(
            "Government Purpose Rights (GPR)",
            "Limited Purpose Rights (LPR)",
            "Unlimited Rights",
            "SBIR Data Rights",
        ),
    ),
    NerEntityType.OPTION_DESCRIPTION: EntityTypeInfo(
        label="OPTION_DESCRIPTION",
        description="Option period descriptions",
        examples=(
            "Option Year 1 (12 months)",
            "Option Period II extending through September 2026",
        ),
    ),
    NerEntityType.FUNDING_TYPE: EntityTypeInfo(
        label="FUNDING_TYPE",
        description="Funding types and structures",
        examples=(
            "incrementally funded",
            "fully funded at award",
            "base plus four option years",
        ),
    ),
    NerEntityType.PROPERTY_ITEM: EntityTypeInfo(
        label="PROPERTY_ITEM",
        description="Government-furnished property, equipment, or information",
        examples=(
            "Government Furnished Equipment (GFE)",
            "GFP: 10 laptop computers",
            "Government Furnished Information (GFI)",
        ),
    ),
    NerEntityType.SB_REQUIREMENT: EntityTypeInfo(
        label="SB_REQUIREMENT",
        description="Small business requirements and set-asides",
        examples=(
            "Small Business Set-Aside",
            "8(a) sole source",
            "HUBZone price evaluation preference",
            "SDVOSB subcontracting goal of 3%",
        ),
    ),
}

# All labels as a tuple for spaCy pipeline registration
ALL_NER_LABELS: tuple[str, ...] = tuple(e.value for e in NerEntityType)
