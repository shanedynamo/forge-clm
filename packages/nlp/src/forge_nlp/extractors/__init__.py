"""Entity extractors for federal contract documents."""

from .rule_based import EntityAnnotation, extract_all_entities

__all__ = ["EntityAnnotation", "extract_all_entities"]
