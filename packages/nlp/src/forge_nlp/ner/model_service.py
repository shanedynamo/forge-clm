"""
NER model service for entity extraction using the trained spaCy model.
"""

from __future__ import annotations

import logging
from pathlib import Path

import spacy
from spacy.language import Language

from forge_nlp.extractors.rule_based import EntityAnnotation

logger = logging.getLogger(__name__)

_PKG_ROOT = Path(__file__).resolve().parent.parent.parent.parent  # packages/nlp
_DEFAULT_MODEL_PATH = _PKG_ROOT / "models" / "forge-ner-v0.1"


class NERService:
    """Extract entities from contract text using the trained spaCy NER model."""

    def __init__(self, model_path: str | Path = _DEFAULT_MODEL_PATH) -> None:
        model_path = Path(model_path)
        if not model_path.exists():
            raise FileNotFoundError(
                f"NER model not found at {model_path}. "
                "Run `python -m forge_nlp.ner.train` first."
            )
        logger.info("Loading NER model from %s", model_path)
        self._nlp: Language = spacy.load(model_path)
        logger.info("NER model loaded — pipes: %s", self._nlp.pipe_names)

    @property
    def labels(self) -> list[str]:
        """Return the entity labels the model can predict."""
        ner = self._nlp.get_pipe("ner")
        return list(ner.labels)  # type: ignore[union-attr]

    def extract_entities(self, text: str) -> list[EntityAnnotation]:
        """Run NER on a single text and return EntityAnnotation objects.

        Args:
            text: The contract text to analyze.

        Returns:
            List of EntityAnnotation sorted by start_char.
        """
        doc = self._nlp(text)
        annotations: list[EntityAnnotation] = []
        for ent in doc.ents:
            # Only include our custom labels (skip built-in NER labels like PERSON, ORG, etc.)
            annotations.append(EntityAnnotation(
                entity_type=ent.label_,
                entity_value=ent.text,
                start_char=ent.start_char,
                end_char=ent.end_char,
                confidence=0.0,  # spaCy doesn't expose per-entity confidence easily
                metadata={"source": "ner_model"},
            ))
        return sorted(annotations, key=lambda a: a.start_char)

    def extract_entities_batch(
        self, texts: list[str],
    ) -> list[list[EntityAnnotation]]:
        """Run NER on a batch of texts.

        Args:
            texts: List of contract text strings.

        Returns:
            List of entity annotation lists, one per input text.
        """
        results: list[list[EntityAnnotation]] = []
        for doc in self._nlp.pipe(texts, batch_size=32):
            annotations: list[EntityAnnotation] = []
            for ent in doc.ents:
                annotations.append(EntityAnnotation(
                    entity_type=ent.label_,
                    entity_value=ent.text,
                    start_char=ent.start_char,
                    end_char=ent.end_char,
                    confidence=0.0,
                    metadata={"source": "ner_model"},
                ))
            results.append(sorted(annotations, key=lambda a: a.start_char))
        return results
