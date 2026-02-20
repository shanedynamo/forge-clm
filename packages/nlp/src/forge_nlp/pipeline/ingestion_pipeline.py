"""
Complete ingestion pipeline: document → structured data in Postgres.

Orchestrates text extraction, entity extraction, chunking, embedding,
metadata mapping, quality checking, and database population.
"""

from __future__ import annotations

import io
import logging
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Protocol

from forge_nlp.chunking.clause_chunker import DocumentChunk, DocumentProcessor
from forge_nlp.embeddings.embedding_service import EmbeddedChunk, EmbeddingService
from forge_nlp.extractors.rule_based import EntityAnnotation, extract_all_entities
from forge_nlp.ner.model_service import NERService
from forge_nlp.pipeline.combined_extractor import CombinedExtractor
from forge_nlp.pipeline.contract_metadata_mapper import ContractMetadata, map_entities_to_metadata
from forge_nlp.pipeline.quality_checker import QualityReport, check_quality

logger = logging.getLogger(__name__)


# ─── Protocols for external dependencies (testable) ───────────────────

class S3Client(Protocol):
    """Minimal S3 client interface."""

    def get_object(self, Bucket: str, Key: str) -> dict[str, Any]: ...


class DbClient(Protocol):
    """Minimal DB client interface for the ingestion pipeline."""

    def upsert_contract(self, metadata: ContractMetadata, s3_key: str) -> str:
        """Create or update a contract record. Returns contract_id (UUID)."""
        ...

    def store_chunks(
        self,
        contract_id: str,
        s3_key: str,
        chunks: list[EmbeddedChunk],
    ) -> list[str]:
        """Store document chunks with embeddings. Returns list of chunk_ids."""
        ...

    def store_entity_annotations(
        self,
        chunk_ids: list[str],
        chunks: list[EmbeddedChunk],
        entities_per_chunk: list[list[EntityAnnotation]],
        model_version: str,
    ) -> int:
        """Store entity annotations linked to chunks. Returns count stored."""
        ...

    def log_agent_execution(
        self,
        agent_type: str,
        task_id: str,
        status: str,
        input_summary: dict,
        output_summary: dict | None,
        error_details: str | None,
    ) -> None:
        """Log to audit.agent_execution_log."""
        ...


# ─── Data classes ─────────────────────────────────────────────────────

@dataclass
class IngestionResult:
    """Result of a full document ingestion."""

    contract_id: str
    s3_key: str
    document_type: str
    text_length: int
    chunk_count: int
    entity_count: int
    chunks_stored: int
    annotations_stored: int
    metadata: ContractMetadata
    quality: QualityReport
    duration_ms: int = 0


# ─── Text extraction ─────────────────────────────────────────────────

def extract_text_from_docx(content: bytes) -> str:
    """Extract text from a .docx file, preserving paragraph structure."""
    import docx

    doc = docx.Document(io.BytesIO(content))
    paragraphs: list[str] = []
    for para in doc.paragraphs:
        text = para.text.strip()
        if text:
            paragraphs.append(text)
    return "\n\n".join(paragraphs)


def extract_text_from_pdf(content: bytes) -> str:
    """Extract text from a PDF file.

    In production this calls AWS Textract. Locally we use a simple
    fallback: try pdfplumber if available, otherwise return the raw
    bytes decoded as UTF-8 (for mock/test PDFs that are actually text).
    """
    try:
        import pdfplumber

        with pdfplumber.open(io.BytesIO(content)) as pdf:
            pages = [page.extract_text() or "" for page in pdf.pages]
            return "\n\n".join(p for p in pages if p.strip())
    except ImportError:
        # Fallback for environments without pdfplumber
        return content.decode("utf-8", errors="replace")


# ─── Assign entities to chunks ────────────────────────────────────────

def _assign_entities_to_chunks(
    entities: list[EntityAnnotation],
    chunks: list[DocumentChunk],
    full_text: str,
) -> list[list[EntityAnnotation]]:
    """Assign entities to the chunk whose text range they fall within.

    Because chunks are produced from sections of the full text and entities
    are indexed by char offset in the full text, we need to map each entity
    to the chunk that contains the matching text.
    """
    result: list[list[EntityAnnotation]] = [[] for _ in chunks]

    for entity in entities:
        entity_text = entity.entity_value
        for i, chunk in enumerate(chunks):
            if entity_text in chunk.chunk_text:
                # Re-index to chunk-local offsets
                local_start = chunk.chunk_text.index(entity_text)
                local_entity = EntityAnnotation(
                    entity_type=entity.entity_type,
                    entity_value=entity.entity_value,
                    start_char=local_start,
                    end_char=local_start + len(entity_text),
                    confidence=entity.confidence,
                    metadata=dict(entity.metadata),
                )
                result[i].append(local_entity)
                break  # assign to first matching chunk

    return result


# ─── Mock DB client for testing / local use ───────────────────────────

class InMemoryDbClient:
    """In-memory DB client for testing and local development."""

    def __init__(self) -> None:
        self.contracts: dict[str, dict] = {}
        self.chunks: dict[str, dict] = {}
        self.annotations: list[dict] = []
        self.audit_logs: list[dict] = []

    def upsert_contract(self, metadata: ContractMetadata, s3_key: str) -> str:
        contract_number = metadata.contract_number or "UNKNOWN"
        # Check if contract already exists by contract_number
        for cid, c in self.contracts.items():
            if c.get("contract_number") == contract_number:
                c.update(self._meta_to_dict(metadata, s3_key))
                return cid
        cid = str(uuid.uuid4())
        self.contracts[cid] = self._meta_to_dict(metadata, s3_key)
        self.contracts[cid]["id"] = cid
        return cid

    def store_chunks(
        self, contract_id: str, s3_key: str, chunks: list[EmbeddedChunk],
    ) -> list[str]:
        chunk_ids: list[str] = []
        for chunk in chunks:
            cid = str(uuid.uuid4())
            self.chunks[cid] = {
                "id": cid,
                "contract_id": contract_id,
                "document_s3_key": s3_key,
                "chunk_index": chunk.chunk_index,
                "section_type": chunk.section_type,
                "clause_number": chunk.clause_number,
                "chunk_text": chunk.chunk_text,
                "embedding": chunk.embedding,
                "metadata_json": chunk.metadata,
            }
            chunk_ids.append(cid)
        return chunk_ids

    def store_entity_annotations(
        self,
        chunk_ids: list[str],
        chunks: list[EmbeddedChunk],
        entities_per_chunk: list[list[EntityAnnotation]],
        model_version: str,
    ) -> int:
        count = 0
        for chunk_id, ents in zip(chunk_ids, entities_per_chunk):
            for ent in ents:
                self.annotations.append({
                    "chunk_id": chunk_id,
                    "entity_type": ent.entity_type,
                    "entity_value": ent.entity_value,
                    "start_char": ent.start_char,
                    "end_char": ent.end_char,
                    "confidence": ent.confidence,
                    "model_version": model_version,
                })
                count += 1
        return count

    def log_agent_execution(
        self,
        agent_type: str,
        task_id: str,
        status: str,
        input_summary: dict,
        output_summary: dict | None,
        error_details: str | None,
    ) -> None:
        self.audit_logs.append({
            "agent_type": agent_type,
            "task_id": task_id,
            "status": status,
            "input_summary": input_summary,
            "output_summary": output_summary,
            "error_details": error_details,
            "started_at": datetime.now(timezone.utc).isoformat(),
        })

    @staticmethod
    def _meta_to_dict(metadata: ContractMetadata, s3_key: str) -> dict:
        return {
            "contract_number": metadata.contract_number or "UNKNOWN",
            "ceiling_value": metadata.ceiling_value,
            "funded_value": metadata.funded_value,
            "pop_start": metadata.pop_start,
            "pop_end": metadata.pop_end,
            "naics_code": metadata.naics_code,
            "psc_code": metadata.psc_code,
            "security_level": metadata.security_level,
            "cage_code": metadata.cage_code,
            "s3_document_key": s3_key,
        }


# ─── Mock S3 client ───────────────────────────────────────────────────

class LocalFileS3Client:
    """S3 client that reads from local filesystem (for testing)."""

    def __init__(self, base_dir: str | Path) -> None:
        self.base_dir = Path(base_dir)

    def get_object(self, Bucket: str, Key: str) -> dict[str, Any]:
        path = self.base_dir / Key
        body = path.read_bytes()
        return {"Body": io.BytesIO(body)}


# ─── Pipeline ─────────────────────────────────────────────────────────

class IngestionPipeline:
    """Orchestrates the full document ingestion flow."""

    def __init__(
        self,
        s3_client: S3Client,
        db_client: DbClient,
        s3_bucket: str = "forge-documents",
        embedding_service: EmbeddingService | None = None,
        combined_extractor: CombinedExtractor | None = None,
        use_ner: bool = True,
        model_version: str = "v0.1",
    ) -> None:
        self.s3 = s3_client
        self.db = db_client
        self.s3_bucket = s3_bucket
        self._embedding_svc = embedding_service
        self._extractor = combined_extractor
        self._use_ner = use_ner
        self._model_version = model_version
        self._doc_processor = DocumentProcessor()

    @property
    def embedding_service(self) -> EmbeddingService:
        if self._embedding_svc is None:
            self._embedding_svc = EmbeddingService()
        return self._embedding_svc

    @property
    def extractor(self) -> CombinedExtractor | None:
        if self._use_ner and self._extractor is None:
            try:
                self._extractor = CombinedExtractor()
            except FileNotFoundError:
                logger.warning("NER model not found, falling back to rule-based only")
                self._use_ner = False
        return self._extractor

    def ingest(self, s3_key: str, document_type: str = "docx") -> IngestionResult:
        """Run the full ingestion pipeline.

        Args:
            s3_key: S3 object key for the document.
            document_type: Either "docx" or "pdf".

        Returns:
            IngestionResult with counts, metadata, and quality report.
        """
        import time
        start = time.monotonic()
        task_id = str(uuid.uuid4())

        try:
            self.db.log_agent_execution(
                agent_type="ingestion_pipeline",
                task_id=task_id,
                status="RUNNING",
                input_summary={"s3_key": s3_key, "document_type": document_type},
                output_summary=None,
                error_details=None,
            )

            # ── 1. Fetch document from S3 ───────────────────────────
            logger.info("Fetching document: %s", s3_key)
            response = self.s3.get_object(Bucket=self.s3_bucket, Key=s3_key)
            content = response["Body"].read()

            # ── 2. Extract text ─────────────────────────────────────
            logger.info("Extracting text from %s", document_type)
            if document_type == "docx":
                text = extract_text_from_docx(content)
            elif document_type == "pdf":
                text = extract_text_from_pdf(content)
            else:
                raise ValueError(f"Unsupported document type: {document_type}")

            if not text.strip():
                raise ValueError("Document produced empty text after extraction")

            # ── 3. Entity extraction ────────────────────────────────
            logger.info("Extracting entities …")
            if self._use_ner and self.extractor is not None:
                entities = self.extractor.extract(text)
            else:
                entities = extract_all_entities(text)

            # ── 4. Document chunking ────────────────────────────────
            logger.info("Chunking document …")
            chunks = self._doc_processor.process(text, document_id=s3_key)

            # ── 5. Embed chunks ─────────────────────────────────────
            logger.info("Generating embeddings for %d chunks …", len(chunks))
            embedded_chunks = self.embedding_service.embed_chunks(chunks)

            # ── 6. Map metadata ─────────────────────────────────────
            metadata = map_entities_to_metadata(text, entities)

            # ── 7. Quality check ────────────────────────────────────
            entities_per_chunk = _assign_entities_to_chunks(entities, chunks, text)
            chunk_entity_counts = [len(ec) for ec in entities_per_chunk]
            quality = check_quality(
                metadata=metadata,
                entities=entities,
                chunk_count=len(chunks),
                chunk_entity_counts=chunk_entity_counts,
            )

            # ── 8. Database population ──────────────────────────────
            logger.info("Storing to database …")
            contract_id = self.db.upsert_contract(metadata, s3_key)

            chunk_ids = self.db.store_chunks(
                contract_id=contract_id,
                s3_key=s3_key,
                chunks=embedded_chunks,
            )

            annotation_count = self.db.store_entity_annotations(
                chunk_ids=chunk_ids,
                chunks=embedded_chunks,
                entities_per_chunk=entities_per_chunk,
                model_version=self._model_version,
            )

            duration_ms = int((time.monotonic() - start) * 1000)

            result = IngestionResult(
                contract_id=contract_id,
                s3_key=s3_key,
                document_type=document_type,
                text_length=len(text),
                chunk_count=len(chunks),
                entity_count=len(entities),
                chunks_stored=len(chunk_ids),
                annotations_stored=annotation_count,
                metadata=metadata,
                quality=quality,
                duration_ms=duration_ms,
            )

            # ── 9. Log success ──────────────────────────────────────
            self.db.log_agent_execution(
                agent_type="ingestion_pipeline",
                task_id=task_id,
                status="SUCCESS" if not quality.needs_human_review else "NEEDS_REVIEW",
                input_summary={"s3_key": s3_key, "document_type": document_type},
                output_summary={
                    "contract_id": contract_id,
                    "chunks": len(chunks),
                    "entities": len(entities),
                    "quality_issues": quality.error_count + quality.warning_count,
                },
                error_details=None,
            )

            logger.info(
                "Ingestion complete: %d chunks, %d entities, %d annotations in %dms",
                len(chunks), len(entities), annotation_count, duration_ms,
            )
            return result

        except Exception as exc:
            self.db.log_agent_execution(
                agent_type="ingestion_pipeline",
                task_id=task_id,
                status="FAILURE",
                input_summary={"s3_key": s3_key, "document_type": document_type},
                output_summary=None,
                error_details=str(exc),
            )
            raise
