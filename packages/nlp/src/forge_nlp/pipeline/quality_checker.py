"""
Quality checker for entity extraction results.

Inspects extraction output and flags issues for human review.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum

from forge_nlp.extractors.rule_based import EntityAnnotation
from forge_nlp.pipeline.contract_metadata_mapper import ContractMetadata


class IssueSeverity(str, Enum):
    WARNING = "WARNING"
    ERROR = "ERROR"


@dataclass
class QualityIssue:
    """A single quality issue found during extraction."""

    severity: IssueSeverity
    code: str
    message: str
    details: dict = field(default_factory=dict)


@dataclass
class QualityReport:
    """Overall quality report for a document ingestion."""

    issues: list[QualityIssue] = field(default_factory=list)
    needs_human_review: bool = False
    review_reasons: list[str] = field(default_factory=list)
    entity_count: int = 0
    chunk_count: int = 0

    @property
    def error_count(self) -> int:
        return sum(1 for i in self.issues if i.severity == IssueSeverity.ERROR)

    @property
    def warning_count(self) -> int:
        return sum(1 for i in self.issues if i.severity == IssueSeverity.WARNING)


def check_quality(
    metadata: ContractMetadata,
    entities: list[EntityAnnotation],
    chunk_count: int = 0,
    chunk_entity_counts: list[int] | None = None,
) -> QualityReport:
    """Check extraction quality and flag issues.

    Args:
        metadata: Mapped contract metadata.
        entities: All extracted entities.
        chunk_count: Number of document chunks.
        chunk_entity_counts: Number of entities per chunk (for empty-chunk detection).

    Returns:
        A QualityReport with any issues found.
    """
    report = QualityReport(
        entity_count=len(entities),
        chunk_count=chunk_count,
    )

    # ── Missing critical fields ─────────────────────────────────────
    if metadata.contract_number is None:
        report.issues.append(QualityIssue(
            severity=IssueSeverity.ERROR,
            code="MISSING_CONTRACT_NUMBER",
            message="No contract number was extracted from the document.",
        ))
        report.needs_human_review = True
        report.review_reasons.append("Missing contract number")

    if metadata.ceiling_value is None:
        report.issues.append(QualityIssue(
            severity=IssueSeverity.WARNING,
            code="MISSING_CEILING_VALUE",
            message="No ceiling value was extracted from the document.",
        ))

    if metadata.pop_start is None or metadata.pop_end is None:
        missing = []
        if metadata.pop_start is None:
            missing.append("start date")
        if metadata.pop_end is None:
            missing.append("end date")
        report.issues.append(QualityIssue(
            severity=IssueSeverity.WARNING,
            code="MISSING_POP_DATES",
            message=f"Missing period of performance {', '.join(missing)}.",
            details={"missing_fields": missing},
        ))

    # ── Low confidence NER extractions ──────────────────────────────
    low_conf = [e for e in entities if 0 < e.confidence < 0.6]
    if low_conf:
        report.issues.append(QualityIssue(
            severity=IssueSeverity.WARNING,
            code="LOW_CONFIDENCE_ENTITIES",
            message=f"{len(low_conf)} entities have confidence below 0.6.",
            details={
                "count": len(low_conf),
                "entities": [
                    {"type": e.entity_type, "value": e.entity_value, "confidence": e.confidence}
                    for e in low_conf[:5]  # cap at 5 for brevity
                ],
            },
        ))

    # ── Conflicting entities ────────────────────────────────────────
    _check_conflicts(entities, report)

    # ── Chunks with no entities ─────────────────────────────────────
    if chunk_entity_counts is not None:
        empty_chunks = sum(1 for c in chunk_entity_counts if c == 0)
        if empty_chunks > 0 and chunk_count > 0:
            ratio = empty_chunks / chunk_count
            if ratio > 0.5:
                report.issues.append(QualityIssue(
                    severity=IssueSeverity.WARNING,
                    code="MANY_EMPTY_CHUNKS",
                    message=(
                        f"{empty_chunks}/{chunk_count} chunks have no entities. "
                        "Possible OCR or text extraction issue."
                    ),
                    details={"empty_chunks": empty_chunks, "total_chunks": chunk_count},
                ))
                report.needs_human_review = True
                report.review_reasons.append("Many chunks without entities — possible extraction issue")

    # ── No entities at all ──────────────────────────────────────────
    if len(entities) == 0:
        report.issues.append(QualityIssue(
            severity=IssueSeverity.ERROR,
            code="NO_ENTITIES_EXTRACTED",
            message="No entities were extracted from the document.",
        ))
        report.needs_human_review = True
        report.review_reasons.append("Zero entities extracted")

    return report


def _check_conflicts(entities: list[EntityAnnotation], report: QualityReport) -> None:
    """Check for conflicting entities of the same type."""
    # Group by type for conflict detection
    by_type: dict[str, list[str]] = {}
    for e in entities:
        by_type.setdefault(e.entity_type, []).append(e.entity_value)

    # Multiple different contract numbers
    contract_nums = set(by_type.get("CONTRACT_NUMBER", []))
    if len(contract_nums) > 1:
        report.issues.append(QualityIssue(
            severity=IssueSeverity.ERROR,
            code="CONFLICTING_CONTRACT_NUMBERS",
            message=f"Multiple different contract numbers found: {', '.join(sorted(contract_nums))}.",
            details={"contract_numbers": sorted(contract_nums)},
        ))
        report.needs_human_review = True
        report.review_reasons.append("Conflicting contract numbers")

    # Multiple different security levels
    sec_levels = set(by_type.get("SECURITY_LEVEL", []))
    if len(sec_levels) > 1:
        report.issues.append(QualityIssue(
            severity=IssueSeverity.WARNING,
            code="CONFLICTING_SECURITY_LEVELS",
            message=f"Multiple security levels found: {', '.join(sorted(sec_levels))}.",
            details={"security_levels": sorted(sec_levels)},
        ))
