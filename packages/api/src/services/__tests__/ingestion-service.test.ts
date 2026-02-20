import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  IngestionService,
  IngestionServiceError,
  type IngestionResponse,
} from "../ingestion-service.js";

// ─── Mock data ──────────────────────────────────────────────────────

const MOCK_SUCCESS_RESPONSE: IngestionResponse = {
  result: {
    contract_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    s3_key: "contracts/test.docx",
    document_type: "docx",
    text_length: 5000,
    chunk_count: 10,
    entity_count: 25,
    chunks_stored: 10,
    annotations_stored: 20,
    metadata: {
      contract_number: "FA8726-24-C-0042",
      ceiling_value: "12500000",
      funded_value: "5000000",
      pop_start: "2024-01-01",
      pop_end: "2025-12-31",
      naics_code: "541330",
      psc_code: "R425",
      security_level: "SECRET",
      cage_code: "1ABC2",
      uei_number: null,
      contracting_officer_name: "Col. James Smith",
      far_clauses: ["52.202-1", "52.212-4"],
      dfars_clauses: ["252.204-7012"],
    },
    duration_ms: 1234,
  },
  quality: {
    issues: [],
    needs_human_review: false,
    review_reasons: [],
    entity_count: 25,
    chunk_count: 10,
  },
};

const MOCK_REVIEW_RESPONSE: IngestionResponse = {
  ...MOCK_SUCCESS_RESPONSE,
  quality: {
    issues: [
      {
        severity: "ERROR",
        code: "CONFLICTING_CONTRACT_NUMBERS",
        message: "Multiple different contract numbers found.",
        details: { contract_numbers: ["FA8726-24-C-0042", "W911NF-23-D-0017"] },
      },
    ],
    needs_human_review: true,
    review_reasons: ["Conflicting contract numbers"],
    entity_count: 25,
    chunk_count: 10,
  },
};

// ─── Tests ──────────────────────────────────────────────────────────

describe("IngestionService", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("calls the NLP endpoint correctly", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(MOCK_SUCCESS_RESPONSE),
    });
    globalThis.fetch = mockFetch;

    const service = new IngestionService("http://nlp:8000");
    const result = await service.ingest({
      s3Key: "contracts/test.docx",
      documentType: "docx",
    });

    // Verify fetch was called with correct URL and body
    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, options] = mockFetch.mock.calls[0]!;
    expect(url).toBe("http://nlp:8000/pipeline/ingest");
    expect(options.method).toBe("POST");

    const body = JSON.parse(options.body);
    expect(body.s3_key).toBe("contracts/test.docx");
    expect(body.document_type).toBe("docx");

    // Verify response mapping
    expect(result.result.contract_id).toBe("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
    expect(result.result.metadata.contract_number).toBe("FA8726-24-C-0042");
    expect(result.quality.needs_human_review).toBe(false);
  });

  it("handles quality issues response", async () => {
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(MOCK_REVIEW_RESPONSE),
    });

    const service = new IngestionService("http://nlp:8000");
    const result = await service.ingest({
      s3Key: "contracts/test.docx",
      documentType: "docx",
    });

    expect(result.quality.needs_human_review).toBe(true);
    expect(result.quality.issues).toHaveLength(1);
    expect(result.quality.issues[0]!.code).toBe("CONFLICTING_CONTRACT_NUMBERS");

    // Should have logged a warning about human review
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("Human review needed"),
      expect.stringContaining("Conflicting contract numbers"),
    );

    consoleSpy.mockRestore();
  });

  it("throws IngestionServiceError when NLP service is unavailable", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));

    const service = new IngestionService("http://nlp:8000");

    await expect(
      service.ingest({ s3Key: "test.docx", documentType: "docx" }),
    ).rejects.toThrow(IngestionServiceError);

    try {
      await service.ingest({ s3Key: "test.docx", documentType: "docx" });
    } catch (err) {
      expect(err).toBeInstanceOf(IngestionServiceError);
      expect((err as IngestionServiceError).statusCode).toBe(503);
      expect((err as IngestionServiceError).message).toContain("unavailable");
    }
  });

  it("throws IngestionServiceError for non-OK response", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      text: () => Promise.resolve('{"detail":"Invalid document type"}'),
    });

    const service = new IngestionService("http://nlp:8000");

    await expect(
      service.ingest({ s3Key: "test.docx", documentType: "docx" }),
    ).rejects.toThrow(IngestionServiceError);

    try {
      await service.ingest({ s3Key: "test.docx", documentType: "docx" });
    } catch (err) {
      expect((err as IngestionServiceError).statusCode).toBe(422);
    }
  });

  it("uses NLP_SERVICE_URL env var when no URL is provided", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(MOCK_SUCCESS_RESPONSE),
    });
    globalThis.fetch = mockFetch;

    process.env["NLP_SERVICE_URL"] = "http://custom-nlp:9000";
    const service = new IngestionService();
    await service.ingest({ s3Key: "test.docx", documentType: "docx" });

    const [url] = mockFetch.mock.calls[0]!;
    expect(url).toBe("http://custom-nlp:9000/pipeline/ingest");

    delete process.env["NLP_SERVICE_URL"];
  });
});
