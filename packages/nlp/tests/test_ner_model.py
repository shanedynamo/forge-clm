"""
Tests for the NER model training, loading, and serving.
"""

from __future__ import annotations

import httpx
import pytest

from forge_nlp.extractors.rule_based import EntityAnnotation
from forge_nlp.ner.model_service import NERService
from forge_nlp.ner.train import train, _DEFAULT_MODEL_DIR


# ─── Fixtures ─────────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def trained_model_dir(tmp_path_factory):
    """Train a small model for testing (uses session-scoped tmp dir)."""
    out = tmp_path_factory.mktemp("ner_model")
    metrics = train(
        base_model="en_core_web_sm",
        output_dir=out,
        n_iter=10,
        n_examples=100,
        seed=99,
    )
    return out, metrics


@pytest.fixture(scope="module")
def ner_service(trained_model_dir):
    """Load the trained model as a NERService."""
    model_dir, _ = trained_model_dir
    return NERService(model_path=model_dir)


# ═══════════════════════════════════════════════════════════════════════
# Training tests
# ═══════════════════════════════════════════════════════════════════════


class TestTraining:
    def test_training_runs_without_errors(self, trained_model_dir):
        """Training should complete and return metrics."""
        _, metrics = trained_model_dir
        assert "ents_f" in metrics
        assert "ents_p" in metrics
        assert "ents_r" in metrics

    def test_training_produces_positive_f1(self, trained_model_dir):
        """Even a short training run should achieve non-zero F1."""
        _, metrics = trained_model_dir
        assert metrics["ents_f"] > 0.0

    def test_model_files_created(self, trained_model_dir):
        """Training should produce model files on disk."""
        model_dir, _ = trained_model_dir
        assert (model_dir / "meta.json").exists()
        assert (model_dir / "config.cfg").exists()
        assert (model_dir / "training_metrics.json").exists()


# ═══════════════════════════════════════════════════════════════════════
# Model loading & inference tests
# ═══════════════════════════════════════════════════════════════════════


class TestNERService:
    def test_model_loads_successfully(self, ner_service: NERService):
        """The trained model should load without errors."""
        assert ner_service is not None
        assert len(ner_service.labels) > 0

    def test_extracts_contracting_officer(self, ner_service: NERService):
        """Model should extract CONTRACTING_OFFICER from a simple sentence."""
        text = (
            "The Contracting Officer, Col. Robert Williams, "
            "shall administer this contract."
        )
        entities = ner_service.extract_entities(text)
        co_entities = [e for e in entities if e.entity_type == "CONTRACTING_OFFICER"]
        assert len(co_entities) >= 1, (
            f"Expected at least 1 CONTRACTING_OFFICER, got: {[e.entity_type for e in entities]}"
        )
        assert any("Williams" in e.entity_value for e in co_entities)

    def test_returns_entity_annotation_objects(self, ner_service: NERService):
        """Results should be EntityAnnotation dataclass instances."""
        text = "The contractor shall provide Government Furnished Equipment (GFE)."
        entities = ner_service.extract_entities(text)
        for e in entities:
            assert isinstance(e, EntityAnnotation)
            assert isinstance(e.entity_type, str)
            assert isinstance(e.entity_value, str)
            assert isinstance(e.start_char, int)
            assert isinstance(e.end_char, int)
            assert e.metadata.get("source") == "ner_model"

    def test_batch_extraction(self, ner_service: NERService):
        """Batch extraction should return a list per input text."""
        texts = [
            "The Contracting Officer, Mr. John Smith, approves the change.",
            "This procurement is a Small Business Set-Aside.",
        ]
        results = ner_service.extract_entities_batch(texts)
        assert len(results) == 2
        assert isinstance(results[0], list)
        assert isinstance(results[1], list)

    def test_empty_text_returns_no_entities(self, ner_service: NERService):
        """Empty or whitespace-only text should return no entities."""
        entities = ner_service.extract_entities("   ")
        assert entities == []

    def test_model_not_found_raises_error(self, tmp_path):
        """NERService should raise FileNotFoundError for missing model."""
        with pytest.raises(FileNotFoundError, match="NER model not found"):
            NERService(model_path=tmp_path / "nonexistent")


# ═══════════════════════════════════════════════════════════════════════
# API endpoint tests
# ═══════════════════════════════════════════════════════════════════════


class TestNEREndpoints:
    @pytest.fixture(scope="class")
    async def client(self):
        """Create an async test client with the NER model available."""
        # Ensure the default model exists (trained during module setup or earlier)
        import api as api_module

        # Point the NER service to the default model
        svc = NERService(model_path=_DEFAULT_MODEL_DIR)
        api_module._ner_service = svc

        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=api_module.app),
            base_url="http://test",
        ) as c:
            yield c

        # Clean up
        api_module._ner_service = None

    @pytest.mark.asyncio
    async def test_ner_extract_endpoint(self, client: httpx.AsyncClient):
        """POST /ner/extract should return entities."""
        resp = await client.post("/ner/extract", json={
            "text": "The Contracting Officer, Mr. David Garcia, approves the deliverable.",
        })
        assert resp.status_code == 200
        data = resp.json()
        assert "entities" in data
        assert isinstance(data["entities"], list)

    @pytest.mark.asyncio
    async def test_ner_extract_batch_endpoint(self, client: httpx.AsyncClient):
        """POST /ner/extract-batch should return results per text."""
        resp = await client.post("/ner/extract-batch", json={
            "texts": [
                "The COR is Lt. Col. Thomas Anderson.",
                "The contractor shall deliver the Final Technical Report.",
            ],
        })
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["results"]) == 2
