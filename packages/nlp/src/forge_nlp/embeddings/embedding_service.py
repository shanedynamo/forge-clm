"""
Embedding service using a legal-domain BERT model.

Locally uses sentence-transformers with nlpaueb/legal-bert-base-uncased.
In production this runs behind a SageMaker endpoint; locally it runs in a
Docker container exposing a FastAPI server.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import ClassVar

from forge_nlp.chunking.clause_chunker import DocumentChunk

logger = logging.getLogger(__name__)

_DEFAULT_MODEL = "nlpaueb/legal-bert-base-uncased"
_DEFAULT_BATCH_SIZE = 32
_EMBEDDING_DIM = 768


@dataclass
class EmbeddedChunk:
    """A DocumentChunk with its embedding vector attached."""

    chunk_text: str
    section_type: str
    clause_number: str | None
    chunk_index: int
    metadata: dict = field(default_factory=dict)
    embedding: list[float] = field(default_factory=list)

    @classmethod
    def from_chunk(cls, chunk: DocumentChunk, embedding: list[float]) -> EmbeddedChunk:
        return cls(
            chunk_text=chunk.chunk_text,
            section_type=chunk.section_type,
            clause_number=chunk.clause_number,
            chunk_index=chunk.chunk_index,
            metadata=dict(chunk.metadata),
            embedding=embedding,
        )


class EmbeddingService:
    """Generate embeddings for contract text using a legal-domain BERT model.

    The underlying ``SentenceTransformer`` model is cached as a class-level
    singleton keyed by model name so it is loaded only once per process.
    """

    _model_cache: ClassVar[dict[str, object]] = {}

    def __init__(
        self,
        model_name: str = _DEFAULT_MODEL,
        batch_size: int = _DEFAULT_BATCH_SIZE,
    ) -> None:
        self.model_name = model_name
        self.batch_size = batch_size
        self._model = self._load_model(model_name)

    # ─── Model loading ─────────────────────────────────────────────

    @classmethod
    def _load_model(cls, model_name: str) -> object:
        """Load (or retrieve from cache) a SentenceTransformer model."""
        if model_name not in cls._model_cache:
            from sentence_transformers import SentenceTransformer

            logger.info("Loading model %s …", model_name)
            model = SentenceTransformer(model_name)
            cls._model_cache[model_name] = model
            logger.info("Model %s loaded — dimension=%d", model_name, model.get_sentence_embedding_dimension())
        return cls._model_cache[model_name]

    @property
    def dimensions(self) -> int:
        return self._model.get_sentence_embedding_dimension()  # type: ignore[union-attr]

    # ─── Embedding methods ─────────────────────────────────────────

    def embed_text(self, text: str) -> list[float]:
        """Embed a single text string. Returns a 768-dimensional vector."""
        embedding = self._model.encode(text, show_progress_bar=False)  # type: ignore[union-attr]
        return embedding.tolist()

    def embed_batch(self, texts: list[str], batch_size: int | None = None) -> list[list[float]]:
        """Embed multiple texts efficiently in batches.

        Args:
            texts: List of text strings to embed.
            batch_size: Override the default batch size.

        Returns:
            List of embedding vectors, one per input text.
        """
        bs = batch_size or self.batch_size
        embeddings = self._model.encode(  # type: ignore[union-attr]
            texts,
            batch_size=bs,
            show_progress_bar=False,
        )
        return embeddings.tolist()

    def embed_chunks(self, chunks: list[DocumentChunk]) -> list[EmbeddedChunk]:
        """Embed all DocumentChunks and return EmbeddedChunks with vectors attached.

        Args:
            chunks: Output from DocumentProcessor / ClauseChunker.

        Returns:
            List of EmbeddedChunk, each carrying its embedding vector.
        """
        if not chunks:
            return []

        texts = [c.chunk_text for c in chunks]
        vectors = self.embed_batch(texts)

        return [
            EmbeddedChunk.from_chunk(chunk, vector)
            for chunk, vector in zip(chunks, vectors)
        ]
