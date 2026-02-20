"""
Comprehensive tests for the embedding service.

NOTE: The first run downloads the LegalBERT model (~440 MB).
Subsequent runs use the cached model.
"""

from __future__ import annotations

import math

import httpx
import pytest

from forge_nlp.chunking.clause_chunker import DocumentChunk
from forge_nlp.embeddings.embedding_service import EmbeddedChunk, EmbeddingService


# ─── Helpers ──────────────────────────────────────────────────────────

def _cosine_similarity(a: list[float], b: list[float]) -> float:
    """Compute cosine similarity between two vectors."""
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = math.sqrt(sum(x * x for x in a))
    norm_b = math.sqrt(sum(x * x for x in b))
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)


# ─── Fixtures ─────────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def service() -> EmbeddingService:
    """Module-scoped service so the model is loaded only once."""
    return EmbeddingService()


# ═══════════════════════════════════════════════════════════════════════
# embed_text tests
# ═══════════════════════════════════════════════════════════════════════


class TestEmbedText:
    def test_returns_768_dimensional_vector(self, service: EmbeddingService):
        """embed_text should return a 768-dimensional vector."""
        vec = service.embed_text("FAR clause 52.212-4 Contract Terms and Conditions")
        assert isinstance(vec, list)
        assert len(vec) == 768
        assert all(isinstance(v, float) for v in vec)

    def test_consistent_results_for_same_input(self, service: EmbeddingService):
        """Embedding the same text twice should yield identical vectors."""
        text = "The contractor shall comply with DFARS 252.204-7012."
        vec1 = service.embed_text(text)
        vec2 = service.embed_text(text)
        assert vec1 == vec2

    def test_similar_texts_produce_similar_embeddings(self, service: EmbeddingService):
        """Semantically similar texts should have cosine similarity > 0.8."""
        text_a = "The contractor shall deliver all items per the schedule in Section F."
        text_b = "All deliverables must be provided according to the delivery schedule."
        vec_a = service.embed_text(text_a)
        vec_b = service.embed_text(text_b)
        sim = _cosine_similarity(vec_a, vec_b)
        assert sim > 0.8, f"Expected cosine similarity > 0.8 for similar texts, got {sim:.4f}"

    def test_dissimilar_texts_produce_different_embeddings(self, service: EmbeddingService):
        """Unrelated texts should have meaningfully lower similarity than related ones."""
        # Similar pair (both about contract deliveries)
        sim_a = "The contractor shall deliver all items per the schedule in Section F."
        sim_b = "All deliverables must be provided according to the delivery schedule."
        sim_similar = _cosine_similarity(
            service.embed_text(sim_a), service.embed_text(sim_b),
        )

        # Dissimilar pair (contract clause vs weather)
        dis_a = "FAR clause 52.212-4 Contract Terms and Conditions"
        dis_b = "The weather is sunny today"
        sim_dissimilar = _cosine_similarity(
            service.embed_text(dis_a), service.embed_text(dis_b),
        )

        # The dissimilar pair should score noticeably lower than the similar pair
        gap = sim_similar - sim_dissimilar
        assert gap > 0.05, (
            f"Expected meaningful gap: similar={sim_similar:.4f}, "
            f"dissimilar={sim_dissimilar:.4f}, gap={gap:.4f}"
        )
        # And the dissimilar pair should be below the similar pair's threshold
        assert sim_dissimilar < sim_similar, (
            f"Dissimilar ({sim_dissimilar:.4f}) should be less than similar ({sim_similar:.4f})"
        )

    def test_realistic_contract_clause_produces_valid_vector(self, service: EmbeddingService):
        """Embedding a realistic contract clause should return a valid vector."""
        clause = (
            "52.219-8 Utilization of Small Business Concerns (SEP 2023) "
            "(a) It is the policy of the United States that small business concerns, "
            "veteran-owned small business concerns, service-disabled veteran-owned "
            "small business concerns, HUBZone small business concerns, small "
            "disadvantaged business concerns, and women-owned small business concerns "
            "shall have the maximum practicable opportunity to participate in performing "
            "contracts let by any Federal agency."
        )
        vec = service.embed_text(clause)
        assert len(vec) == 768
        # Vector should not be all zeros
        assert any(v != 0.0 for v in vec)
        # Vector should have reasonable magnitude
        magnitude = math.sqrt(sum(v * v for v in vec))
        assert 0.5 < magnitude < 50.0, f"Unexpected magnitude: {magnitude}"


# ═══════════════════════════════════════════════════════════════════════
# embed_batch tests
# ═══════════════════════════════════════════════════════════════════════


class TestEmbedBatch:
    def test_batch_matches_individual_calls(self, service: EmbeddingService):
        """embed_batch should produce the same results as individual embed_text calls."""
        texts = [
            "Section A — Solicitation/Contract Form",
            "Section I — Contract Clauses",
            "The period of performance is 12 months.",
        ]
        batch_results = service.embed_batch(texts)
        individual_results = [service.embed_text(t) for t in texts]

        assert len(batch_results) == len(individual_results)
        for i, (batch_vec, indiv_vec) in enumerate(zip(batch_results, individual_results)):
            assert len(batch_vec) == 768
            # Small floating-point differences are expected between batch and
            # individual encoding due to padding/batching in the model.
            sim = _cosine_similarity(batch_vec, indiv_vec)
            assert sim > 0.9999, (
                f"Batch vs individual mismatch for text {i}: cosine sim = {sim:.6f}"
            )

    def test_batch_with_custom_batch_size(self, service: EmbeddingService):
        """embed_batch should accept a custom batch_size."""
        texts = [f"Contract clause number {i}" for i in range(10)]
        results = service.embed_batch(texts, batch_size=3)
        assert len(results) == 10
        assert all(len(v) == 768 for v in results)


# ═══════════════════════════════════════════════════════════════════════
# embed_chunks tests
# ═══════════════════════════════════════════════════════════════════════


class TestEmbedChunks:
    def test_attaches_embeddings_to_chunks(self, service: EmbeddingService):
        """embed_chunks should return EmbeddedChunk objects with vectors."""
        chunks = [
            DocumentChunk(
                chunk_text="52.202-1 Definitions (JUN 2020) — establishes definitions.",
                section_type="SECTION_I",
                clause_number="52.202-1",
                chunk_index=0,
                metadata={"word_count": 7, "document_id": "test"},
            ),
            DocumentChunk(
                chunk_text="The total contract value is $5,000,000.",
                section_type="SECTION_B",
                clause_number=None,
                chunk_index=1,
                metadata={"word_count": 7, "document_id": "test"},
            ),
        ]

        embedded = service.embed_chunks(chunks)

        assert len(embedded) == 2
        for ec in embedded:
            assert isinstance(ec, EmbeddedChunk)
            assert len(ec.embedding) == 768
            assert isinstance(ec.embedding[0], float)

        # Verify metadata is preserved
        assert embedded[0].clause_number == "52.202-1"
        assert embedded[0].section_type == "SECTION_I"
        assert embedded[0].metadata["document_id"] == "test"
        assert embedded[1].clause_number is None
        assert embedded[1].section_type == "SECTION_B"

    def test_embed_empty_chunks(self, service: EmbeddingService):
        """embed_chunks with empty list should return empty list."""
        result = service.embed_chunks([])
        assert result == []


# ═══════════════════════════════════════════════════════════════════════
# FastAPI endpoint tests
# ═══════════════════════════════════════════════════════════════════════


class TestFastAPIEndpoints:
    @pytest.fixture(scope="class")
    async def client(self):
        """Create an async test client for the FastAPI app."""
        from api import app as fastapi_app

        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=fastapi_app),
            base_url="http://test",
        ) as c:
            yield c

    @pytest.mark.asyncio
    async def test_health_endpoint(self, client: httpx.AsyncClient):
        """GET /health should return model info."""
        resp = await client.get("/health")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "ok"
        assert data["model_loaded"] is True
        assert data["model_name"] == "nlpaueb/legal-bert-base-uncased"
        assert data["dimensions"] == 768

    @pytest.mark.asyncio
    async def test_embed_endpoint(self, client: httpx.AsyncClient):
        """POST /embed should return embeddings for a batch of texts."""
        resp = await client.post("/embed", json={
            "texts": [
                "FAR 52.212-4 Contract Terms and Conditions",
                "DFARS 252.204-7012 Safeguarding Covered Defense Information",
            ],
        })
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["embeddings"]) == 2
        assert all(len(e) == 768 for e in data["embeddings"])
        assert data["model"] == "nlpaueb/legal-bert-base-uncased"
        assert data["dimensions"] == 768

    @pytest.mark.asyncio
    async def test_embed_chunks_endpoint(self, client: httpx.AsyncClient):
        """POST /embed-chunks should embed chunk objects."""
        resp = await client.post("/embed-chunks", json={
            "chunks": [
                {
                    "chunk_text": "The contractor shall provide monthly reports.",
                    "section_type": "SECTION_C",
                    "clause_number": None,
                    "chunk_index": 0,
                    "metadata": {"word_count": 6},
                },
            ],
        })
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["embedded_chunks"]) == 1
        ec = data["embedded_chunks"][0]
        assert len(ec["embedding"]) == 768
        assert ec["section_type"] == "SECTION_C"

    @pytest.mark.asyncio
    async def test_embed_endpoint_empty_texts_rejected(self, client: httpx.AsyncClient):
        """POST /embed with empty texts list should return 422."""
        resp = await client.post("/embed", json={"texts": []})
        assert resp.status_code == 422


# ═══════════════════════════════════════════════════════════════════════
# Docker container test
# ═══════════════════════════════════════════════════════════════════════


def _nlp_container_running() -> bool:
    """Check if the forge nlp Docker service is running on port 8000."""
    try:
        resp = httpx.get("http://localhost:8000/health", timeout=3)
        if resp.status_code != 200:
            return False
        data = resp.json()
        # Verify it's actually *our* service, not something else on port 8000
        return data.get("model_name") == "nlpaueb/legal-bert-base-uncased"
    except Exception:
        return False


class TestDockerContainer:
    @pytest.mark.skipif(
        not _nlp_container_running(),
        reason="NLP Docker container not running on port 8000",
    )
    def test_docker_health_endpoint(self):
        """The Docker container's health endpoint should respond."""
        resp = httpx.get("http://localhost:8000/health", timeout=10)
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "ok"
        assert data["model_loaded"] is True
        assert data["model_name"] == "nlpaueb/legal-bert-base-uncased"
        assert data["dimensions"] == 768
