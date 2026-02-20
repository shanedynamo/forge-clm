"""Custom NER model for federal contract entities."""

from .entity_types import NER_ENTITY_TYPES, NerEntityType
from .model_service import NERService

__all__ = ["NER_ENTITY_TYPES", "NerEntityType", "NERService"]
