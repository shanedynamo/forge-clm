"""
Tests for synthetic training data generation.
"""

from __future__ import annotations

import spacy
import pytest
from spacy.tokens import DocBin

from forge_nlp.ner.entity_types import ALL_NER_LABELS, NerEntityType
from forge_nlp.ner.synthetic_data import build_docbin, generate_examples


# ─── Fixtures ─────────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def examples():
    """Generate 500 examples once for the module."""
    return generate_examples(n=500, seed=42)


@pytest.fixture(scope="module")
def docbin(examples):
    """Build a DocBin from the examples."""
    return build_docbin(examples)


# ═══════════════════════════════════════════════════════════════════════
# Tests
# ═══════════════════════════════════════════════════════════════════════


class TestSyntheticDataGeneration:
    def test_produces_500_examples(self, examples):
        """Generator should produce exactly 500 examples."""
        assert len(examples) == 500

    def test_each_example_has_entity_annotations(self, examples):
        """Each example should have at least 2 entity annotations."""
        for i, ex in enumerate(examples):
            assert len(ex.entities) >= 2, (
                f"Example {i} has only {len(ex.entities)} entities"
            )

    def test_each_example_has_at_most_5_annotations(self, examples):
        """Each example should have at most 5 entity annotations."""
        for i, ex in enumerate(examples):
            assert len(ex.entities) <= 5, (
                f"Example {i} has {len(ex.entities)} entities (max 5)"
            )

    def test_entity_spans_within_text_bounds(self, examples):
        """All entity spans must be within the text length."""
        for i, ex in enumerate(examples):
            text_len = len(ex.text)
            for j, span in enumerate(ex.entities):
                assert 0 <= span.start < text_len, (
                    f"Example {i}, span {j}: start={span.start} out of bounds (len={text_len})"
                )
                assert 0 < span.end <= text_len, (
                    f"Example {i}, span {j}: end={span.end} out of bounds (len={text_len})"
                )
                assert span.start < span.end, (
                    f"Example {i}, span {j}: start ({span.start}) >= end ({span.end})"
                )

    def test_entity_spans_do_not_overlap(self, examples):
        """Entity spans within a single example should not overlap."""
        for i, ex in enumerate(examples):
            sorted_spans = sorted(ex.entities, key=lambda s: s.start)
            for j in range(len(sorted_spans) - 1):
                current = sorted_spans[j]
                next_span = sorted_spans[j + 1]
                assert current.end <= next_span.start, (
                    f"Example {i}: span {j} [{current.start}:{current.end}] "
                    f"overlaps with span {j+1} [{next_span.start}:{next_span.end}]"
                )

    def test_all_entity_types_represented(self, examples):
        """All 10 entity types should appear at least once across the dataset."""
        found_types: set[str] = set()
        for ex in examples:
            for span in ex.entities:
                found_types.add(span.label)

        for ner_type in NerEntityType:
            assert ner_type.value in found_types, (
                f"Entity type {ner_type.value} not found in any training example"
            )

    def test_entity_text_matches_span(self, examples):
        """The text at the span positions should be a non-empty string."""
        for i, ex in enumerate(examples):
            for j, span in enumerate(ex.entities):
                extracted = ex.text[span.start:span.end]
                assert len(extracted.strip()) > 0, (
                    f"Example {i}, span {j}: empty text at [{span.start}:{span.end}]"
                )

    def test_entity_labels_are_valid(self, examples):
        """All entity labels should be one of the defined NER types."""
        valid_labels = set(ALL_NER_LABELS)
        for i, ex in enumerate(examples):
            for j, span in enumerate(ex.entities):
                assert span.label in valid_labels, (
                    f"Example {i}, span {j}: unknown label '{span.label}'"
                )


class TestDocBin:
    def test_docbin_contains_all_examples(self, docbin):
        """The DocBin should contain 500 docs."""
        nlp = spacy.blank("en")
        docs = list(docbin.get_docs(nlp.vocab))
        assert len(docs) == 500

    def test_docbin_docs_have_entities(self, docbin):
        """Each doc in the DocBin should have entities."""
        nlp = spacy.blank("en")
        docs = list(docbin.get_docs(nlp.vocab))
        docs_with_ents = [d for d in docs if len(d.ents) > 0]
        assert len(docs_with_ents) == 500

    def test_docbin_round_trip(self, examples, tmp_path):
        """Build a DocBin, save to disk, reload — entities should survive."""
        db = build_docbin(examples)
        path = tmp_path / "test.spacy"
        db.to_disk(path)

        loaded = DocBin().from_disk(path)
        nlp = spacy.blank("en")
        docs = list(loaded.get_docs(nlp.vocab))
        assert len(docs) == len(examples)

        # Check first few docs have entities
        for doc in docs[:10]:
            assert len(doc.ents) >= 2

    def test_reproducibility(self):
        """Same seed should produce identical examples."""
        ex1 = generate_examples(n=50, seed=123)
        ex2 = generate_examples(n=50, seed=123)
        for a, b in zip(ex1, ex2):
            assert a.text == b.text
            assert len(a.entities) == len(b.entities)
