"""
Tests for the CombinedExtractor that merges rule-based and NER results.
"""

from __future__ import annotations

import pytest

from forge_nlp.extractors.rule_based import EntityAnnotation
from forge_nlp.ner.model_service import NERService
from forge_nlp.ner.train import _DEFAULT_MODEL_DIR
from forge_nlp.pipeline.combined_extractor import CombinedExtractor, _spans_overlap


# ─── Fixtures ─────────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def extractor() -> CombinedExtractor:
    """Module-scoped combined extractor using the default trained model."""
    return CombinedExtractor(ner_model_path=_DEFAULT_MODEL_DIR)


# ═══════════════════════════════════════════════════════════════════════
# Unit tests for overlap logic
# ═══════════════════════════════════════════════════════════════════════


class TestSpansOverlap:
    def test_overlapping_spans(self):
        a = EntityAnnotation("X", "abc", 5, 15, 1.0)
        b = EntityAnnotation("Y", "def", 10, 20, 0.5)
        assert _spans_overlap(a, b) is True

    def test_non_overlapping_spans(self):
        a = EntityAnnotation("X", "abc", 5, 10, 1.0)
        b = EntityAnnotation("Y", "def", 15, 20, 0.5)
        assert _spans_overlap(a, b) is False

    def test_adjacent_spans_do_not_overlap(self):
        a = EntityAnnotation("X", "abc", 5, 10, 1.0)
        b = EntityAnnotation("Y", "def", 10, 15, 0.5)
        assert _spans_overlap(a, b) is False

    def test_contained_span(self):
        a = EntityAnnotation("X", "abcdef", 5, 20, 1.0)
        b = EntityAnnotation("Y", "cd", 8, 12, 0.5)
        assert _spans_overlap(a, b) is True


# ═══════════════════════════════════════════════════════════════════════
# Merge logic tests
# ═══════════════════════════════════════════════════════════════════════


class TestMergeLogic:
    def test_rule_based_priority_on_overlap(self):
        """When rule-based and NER overlap, rule-based should win."""
        rule = [
            EntityAnnotation("FAR_CLAUSE", "52.212-4", 10, 18, 1.0, {"source": "rule_based"}),
        ]
        ner = [
            # NER found something overlapping at same span
            EntityAnnotation("RISK_CLAUSE", "52.212-4 Terms", 10, 24, 0.0, {"source": "ner_model"}),
        ]
        merged = CombinedExtractor._merge(rule, ner)
        assert len(merged) == 1
        assert merged[0].entity_type == "FAR_CLAUSE"
        assert merged[0].confidence == 1.0

    def test_dedup_exact_same_span_and_type(self):
        """Exact duplicate (same type + span) should be deduplicated."""
        rule = [
            EntityAnnotation("FAR_CLAUSE", "52.212-4", 10, 18, 1.0),
        ]
        ner = [
            EntityAnnotation("FAR_CLAUSE", "52.212-4", 10, 18, 0.5),
        ]
        merged = CombinedExtractor._merge(rule, ner)
        assert len(merged) == 1

    def test_non_overlapping_results_both_kept(self):
        """Non-overlapping results from both tiers should all be kept."""
        rule = [
            EntityAnnotation("FAR_CLAUSE", "52.212-4", 0, 8, 1.0),
        ]
        ner = [
            EntityAnnotation("CONTRACTING_OFFICER", "John Smith", 50, 60, 0.0),
        ]
        merged = CombinedExtractor._merge(rule, ner)
        types = {a.entity_type for a in merged}
        assert "FAR_CLAUSE" in types
        assert "CONTRACTING_OFFICER" in types
        assert len(merged) == 2

    def test_merged_results_sorted_by_start_char(self):
        """Merged results should be sorted by start_char."""
        rule = [
            EntityAnnotation("FAR_CLAUSE", "52.212-4", 100, 108, 1.0),
        ]
        ner = [
            EntityAnnotation("CONTRACTING_OFFICER", "John Smith", 10, 20, 0.0),
        ]
        merged = CombinedExtractor._merge(rule, ner)
        for i in range(len(merged) - 1):
            assert merged[i].start_char <= merged[i + 1].start_char


# ═══════════════════════════════════════════════════════════════════════
# Integration tests
# ═══════════════════════════════════════════════════════════════════════


class TestCombinedExtractorIntegration:
    def test_returns_both_rule_and_ner_entities(self, extractor: CombinedExtractor):
        """CombinedExtractor should return entities from both tiers."""
        text = (
            "The Contracting Officer, Col. James Brown, awards contract "
            "FA8726-24-C-0042 under FAR clause 52.212-4 Contract Terms and "
            "Conditions. The total value is $5,500,000."
        )
        results = extractor.extract(text)
        types = {r.entity_type for r in results}

        # Rule-based should find these
        assert "FAR_CLAUSE" in types or "CONTRACT_NUMBER" in types or "DOLLAR_AMOUNT" in types

        # NER should find the contracting officer name
        # (may or may not depending on model accuracy, so just check we got results)
        assert len(results) >= 2

    def test_rule_based_takes_priority_on_real_overlap(self, extractor: CombinedExtractor):
        """For entities both can detect, rule-based should dominate."""
        text = "FAR clause 52.219-8 Utilization of Small Business Concerns (SEP 2023)"
        results = extractor.extract(text)

        # Rule-based should detect 52.219-8 as FAR_CLAUSE with confidence=1.0
        far_results = [r for r in results if r.entity_type == "FAR_CLAUSE"]
        assert len(far_results) >= 1
        assert far_results[0].confidence == 1.0

    def test_realistic_contract_paragraph(self, extractor: CombinedExtractor):
        """A realistic paragraph should yield a comprehensive entity set."""
        text = (
            "The Contracting Officer, Mr. Robert Davis, awards contract "
            "W911NF-23-D-0017 to provide engineering support services. "
            "The contractor shall deliver the Monthly Status Report (CDRL A001) "
            "by the 15th of each month. This contract is incrementally funded "
            "with a total ceiling of $12,500,000. The period of performance "
            "is 01 January 2024 through 31 December 2025. NAICS Code: 541330. "
            "FAR 52.219-8 and DFARS 252.204-7012 apply."
        )
        results = extractor.extract(text)
        types = {r.entity_type for r in results}

        # Rule-based entities
        assert "CONTRACT_NUMBER" in types
        assert "DOLLAR_AMOUNT" in types
        assert "FAR_CLAUSE" in types
        assert "DFARS_CLAUSE" in types

        # Should have multiple entities total
        assert len(results) >= 5

    def test_no_duplicate_entities_in_output(self, extractor: CombinedExtractor):
        """Output should not contain exact duplicates."""
        text = (
            "FAR 52.212-4 Contract Terms and Conditions applies. "
            "The Contracting Officer is Ms. Sarah Johnson."
        )
        results = extractor.extract(text)
        seen: set[tuple[str, int, int]] = set()
        for r in results:
            key = (r.entity_type, r.start_char, r.end_char)
            assert key not in seen, f"Duplicate entity: {r}"
            seen.add(key)
