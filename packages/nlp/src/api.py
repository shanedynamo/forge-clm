"""
FastAPI application for the Forge NLP service.

Serves embedding, NER, and combined extraction endpoints.

Run locally:
    uvicorn api:app --host 0.0.0.0 --port 8000 --reload

In Docker the entrypoint calls this module directly.
"""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from forge_nlp.chunking.clause_chunker import DocumentChunk
from forge_nlp.embeddings.embedding_service import EmbeddedChunk, EmbeddingService

logger = logging.getLogger(__name__)

# ─── Pydantic models ───────────────────────────────────────────────────

class EmbedRequest(BaseModel):
    texts: list[str] = Field(..., min_length=1, description="Texts to embed")
    model: str | None = Field(None, description="Model override (unused in local mode)")


class EmbedResponse(BaseModel):
    embeddings: list[list[float]]
    model: str
    dimensions: int


class ChunkInput(BaseModel):
    chunk_text: str
    section_type: str = "OTHER"
    clause_number: str | None = None
    chunk_index: int = 0
    metadata: dict[str, Any] = Field(default_factory=dict)


class EmbeddedChunkOutput(BaseModel):
    chunk_text: str
    section_type: str
    clause_number: str | None
    chunk_index: int
    metadata: dict[str, Any]
    embedding: list[float]


class EmbedChunksRequest(BaseModel):
    chunks: list[ChunkInput] = Field(..., min_length=1)


class EmbedChunksResponse(BaseModel):
    embedded_chunks: list[EmbeddedChunkOutput]


class HealthResponse(BaseModel):
    status: str
    model_loaded: bool
    model_name: str
    dimensions: int


# ─── NER Pydantic models ──────────────────────────────────────────────

class EntityAnnotationOutput(BaseModel):
    entity_type: str
    entity_value: str
    start_char: int
    end_char: int
    confidence: float
    metadata: dict[str, Any] = Field(default_factory=dict)


class NerExtractRequest(BaseModel):
    text: str = Field(..., min_length=1)


class NerExtractResponse(BaseModel):
    entities: list[EntityAnnotationOutput]


class NerBatchRequest(BaseModel):
    texts: list[str] = Field(..., min_length=1)


class NerBatchResponse(BaseModel):
    results: list[list[EntityAnnotationOutput]]


# ─── App & service ─────────────────────────────────────────────────────

# Lazy-initialized on first request (or at startup via lifespan)
_service: EmbeddingService | None = None


def _get_service() -> EmbeddingService:
    global _service  # noqa: PLW0603
    if _service is None:
        _service = EmbeddingService()
    return _service


@asynccontextmanager
async def _lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Pre-load the model at startup so the first request is fast."""
    try:
        _get_service()
        logger.info("Embedding service ready")
    except Exception:
        logger.exception("Failed to load embedding model at startup")
    yield


app = FastAPI(title="Forge NLP Embedding Service", version="0.1.0", lifespan=_lifespan)


# ─── Endpoints ─────────────────────────────────────────────────────────

@app.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    svc = _get_service()
    return HealthResponse(
        status="ok",
        model_loaded=True,
        model_name=svc.model_name,
        dimensions=svc.dimensions,
    )


@app.post("/embed", response_model=EmbedResponse)
async def embed(request: EmbedRequest) -> EmbedResponse:
    if not request.texts:
        raise HTTPException(status_code=422, detail="texts must not be empty")
    svc = _get_service()
    embeddings = svc.embed_batch(request.texts)
    return EmbedResponse(
        embeddings=embeddings,
        model=svc.model_name,
        dimensions=svc.dimensions,
    )


@app.post("/embed-chunks", response_model=EmbedChunksResponse)
async def embed_chunks(request: EmbedChunksRequest) -> EmbedChunksResponse:
    svc = _get_service()

    # Convert Pydantic inputs to DocumentChunk dataclasses
    chunks = [
        DocumentChunk(
            chunk_text=c.chunk_text,
            section_type=c.section_type,
            clause_number=c.clause_number,
            chunk_index=c.chunk_index,
            metadata=dict(c.metadata),
        )
        for c in request.chunks
    ]

    embedded: list[EmbeddedChunk] = svc.embed_chunks(chunks)

    return EmbedChunksResponse(
        embedded_chunks=[
            EmbeddedChunkOutput(
                chunk_text=ec.chunk_text,
                section_type=ec.section_type,
                clause_number=ec.clause_number,
                chunk_index=ec.chunk_index,
                metadata=ec.metadata,
                embedding=ec.embedding,
            )
            for ec in embedded
        ]
    )


# ─── NER endpoints ───────────────────────────────────────────────────

_ner_service: object | None = None  # NERService or None


def _get_ner_service():
    """Lazy-load the NER service (only if a trained model exists)."""
    global _ner_service  # noqa: PLW0603
    if _ner_service is None:
        from forge_nlp.ner.model_service import NERService
        _ner_service = NERService()
    return _ner_service


def _annotation_to_output(ann) -> EntityAnnotationOutput:
    return EntityAnnotationOutput(
        entity_type=ann.entity_type,
        entity_value=ann.entity_value,
        start_char=ann.start_char,
        end_char=ann.end_char,
        confidence=ann.confidence,
        metadata=dict(ann.metadata),
    )


@app.post("/ner/extract", response_model=NerExtractResponse)
async def ner_extract(request: NerExtractRequest) -> NerExtractResponse:
    svc = _get_ner_service()
    entities = svc.extract_entities(request.text)
    return NerExtractResponse(
        entities=[_annotation_to_output(e) for e in entities],
    )


@app.post("/ner/extract-batch", response_model=NerBatchResponse)
async def ner_extract_batch(request: NerBatchRequest) -> NerBatchResponse:
    svc = _get_ner_service()
    all_results = svc.extract_entities_batch(request.texts)
    return NerBatchResponse(
        results=[
            [_annotation_to_output(e) for e in entities]
            for entities in all_results
        ],
    )


# ─── Pipeline ingestion endpoint ─────────────────────────────────────

class QualityIssueOutput(BaseModel):
    severity: str
    code: str
    message: str
    details: dict[str, Any] = Field(default_factory=dict)


class QualityReportOutput(BaseModel):
    issues: list[QualityIssueOutput]
    needs_human_review: bool
    review_reasons: list[str]
    entity_count: int
    chunk_count: int


class ContractMetadataOutput(BaseModel):
    contract_number: str | None
    ceiling_value: str | None
    funded_value: str | None
    pop_start: str | None
    pop_end: str | None
    naics_code: str | None
    psc_code: str | None
    security_level: str | None
    cage_code: str | None
    uei_number: str | None
    contracting_officer_name: str | None
    far_clauses: list[str]
    dfars_clauses: list[str]


class IngestionResultOutput(BaseModel):
    contract_id: str
    s3_key: str
    document_type: str
    text_length: int
    chunk_count: int
    entity_count: int
    chunks_stored: int
    annotations_stored: int
    metadata: ContractMetadataOutput
    duration_ms: int


class IngestRequest(BaseModel):
    s3_key: str = Field(..., min_length=1)
    document_type: str = Field(default="docx", pattern="^(docx|pdf)$")


class IngestResponse(BaseModel):
    result: IngestionResultOutput
    quality: QualityReportOutput


@app.post("/pipeline/ingest", response_model=IngestResponse)
async def pipeline_ingest(request: IngestRequest) -> IngestResponse:
    from forge_nlp.pipeline.ingestion_pipeline import (
        InMemoryDbClient,
        IngestionPipeline,
        LocalFileS3Client,
    )
    import os

    # For local dev: use local filesystem as S3 mock
    s3_base = os.environ.get("S3_LOCAL_DIR", "/tmp/forge-documents")
    s3_client = LocalFileS3Client(base_dir=s3_base)
    db_client = InMemoryDbClient()

    pipeline = IngestionPipeline(
        s3_client=s3_client,
        db_client=db_client,
        embedding_service=_get_service(),
    )

    result = pipeline.ingest(s3_key=request.s3_key, document_type=request.document_type)

    return IngestResponse(
        result=IngestionResultOutput(
            contract_id=result.contract_id,
            s3_key=result.s3_key,
            document_type=result.document_type,
            text_length=result.text_length,
            chunk_count=result.chunk_count,
            entity_count=result.entity_count,
            chunks_stored=result.chunks_stored,
            annotations_stored=result.annotations_stored,
            metadata=ContractMetadataOutput(
                contract_number=result.metadata.contract_number,
                ceiling_value=result.metadata.ceiling_value,
                funded_value=result.metadata.funded_value,
                pop_start=result.metadata.pop_start,
                pop_end=result.metadata.pop_end,
                naics_code=result.metadata.naics_code,
                psc_code=result.metadata.psc_code,
                security_level=result.metadata.security_level,
                cage_code=result.metadata.cage_code,
                uei_number=result.metadata.uei_number,
                contracting_officer_name=result.metadata.contracting_officer_name,
                far_clauses=result.metadata.far_clauses,
                dfars_clauses=result.metadata.dfars_clauses,
            ),
            duration_ms=result.duration_ms,
        ),
        quality=QualityReportOutput(
            issues=[
                QualityIssueOutput(
                    severity=i.severity.value,
                    code=i.code,
                    message=i.message,
                    details=i.details,
                )
                for i in result.quality.issues
            ],
            needs_human_review=result.quality.needs_human_review,
            review_reasons=result.quality.review_reasons,
            entity_count=result.quality.entity_count,
            chunk_count=result.quality.chunk_count,
        ),
    )
