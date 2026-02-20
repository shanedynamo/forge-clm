"""
Combined extractor that merges Tier-1 (rule-based) and Tier-2 (NER) results.

Rule-based results take priority on overlap because they have 1.0 confidence
for deterministic pattern matches.  NER fills in entities that rule-based
cannot detect (e.g. CONTRACTING_OFFICER, SCOPE_DESCRIPTION).
"""

from __future__ import annotations

from pathlib import Path

from forge_nlp.extractors.rule_based import EntityAnnotation, extract_all_entities
from forge_nlp.ner.model_service import NERService


def _spans_overlap(a: EntityAnnotation, b: EntityAnnotation) -> bool:
    """Return True if the character spans of *a* and *b* overlap."""
    return a.start_char < b.end_char and b.start_char < a.end_char


class CombinedExtractor:
    """Run both rule-based and NER extraction and merge results.

    Merging strategy:
      1. Run rule-based extractors (confidence=1.0 for matches).
      2. Run NER model.
      3. For each NER result, discard it if it overlaps with any rule-based
         result (rule-based wins).
      4. Deduplicate: if both produce the exact same span + type, keep the
         rule-based version (higher confidence).
      5. Sort merged results by start_char.
    """

    def __init__(self, ner_model_path: str | Path | None = None) -> None:
        if ner_model_path is not None:
            self._ner = NERService(model_path=ner_model_path)
        else:
            self._ner = NERService()  # uses default path

    def extract(self, text: str) -> list[EntityAnnotation]:
        """Extract entities using both rule-based and NER, merged.

        Args:
            text: Contract text to analyze.

        Returns:
            Merged, deduplicated list of EntityAnnotation sorted by start_char.
        """
        # Tier 1: rule-based (deterministic, confidence=1.0)
        rule_results = extract_all_entities(text)

        # Tier 2: NER model
        ner_results = self._ner.extract_entities(text)

        return self._merge(rule_results, ner_results)

    @staticmethod
    def _merge(
        rule_results: list[EntityAnnotation],
        ner_results: list[EntityAnnotation],
    ) -> list[EntityAnnotation]:
        """Merge rule-based and NER results with rule-based priority."""
        merged: list[EntityAnnotation] = list(rule_results)

        # Exact-span dedup set: (type, start, end)
        seen: set[tuple[str, int, int]] = {
            (a.entity_type, a.start_char, a.end_char) for a in rule_results
        }

        for ner_ann in ner_results:
            key = (ner_ann.entity_type, ner_ann.start_char, ner_ann.end_char)
            if key in seen:
                continue  # exact duplicate — rule-based already has it

            # Check overlap with any rule-based annotation
            overlaps = any(_spans_overlap(ner_ann, rb) for rb in rule_results)
            if overlaps:
                continue  # rule-based takes priority

            seen.add(key)
            merged.append(ner_ann)

        return sorted(merged, key=lambda a: (a.start_char, a.entity_type))
