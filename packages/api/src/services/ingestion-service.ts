/**
 * Ingestion service — calls the NLP microservice to process contract documents.
 *
 * Handles the pipeline response including quality flags, and creates
 * review tasks when human review is needed.
 */

export interface IngestionRequest {
  s3Key: string;
  documentType: "docx" | "pdf";
}

export interface QualityIssue {
  severity: "WARNING" | "ERROR";
  code: string;
  message: string;
  details: Record<string, unknown>;
}

export interface QualityReport {
  issues: QualityIssue[];
  needs_human_review: boolean;
  review_reasons: string[];
  entity_count: number;
  chunk_count: number;
}

export interface ContractMetadata {
  contract_number: string | null;
  ceiling_value: string | null;
  funded_value: string | null;
  pop_start: string | null;
  pop_end: string | null;
  naics_code: string | null;
  psc_code: string | null;
  security_level: string | null;
  cage_code: string | null;
  uei_number: string | null;
  contracting_officer_name: string | null;
  far_clauses: string[];
  dfars_clauses: string[];
}

export interface IngestionResultData {
  contract_id: string;
  s3_key: string;
  document_type: string;
  text_length: number;
  chunk_count: number;
  entity_count: number;
  chunks_stored: number;
  annotations_stored: number;
  metadata: ContractMetadata;
  duration_ms: number;
}

export interface IngestionResponse {
  result: IngestionResultData;
  quality: QualityReport;
}

export class IngestionServiceError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number = 500,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "IngestionServiceError";
  }
}

export class IngestionService {
  private readonly nlpBaseUrl: string;

  constructor(nlpBaseUrl?: string) {
    this.nlpBaseUrl =
      nlpBaseUrl ??
      process.env["NLP_SERVICE_URL"] ??
      "http://localhost:8000";
  }

  /**
   * Ingest a contract document via the NLP pipeline.
   */
  async ingest(request: IngestionRequest): Promise<IngestionResponse> {
    const url = `${this.nlpBaseUrl}/pipeline/ingest`;

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          s3_key: request.s3Key,
          document_type: request.documentType,
        }),
      });
    } catch (err) {
      throw new IngestionServiceError(
        `NLP service unavailable at ${this.nlpBaseUrl}: ${err instanceof Error ? err.message : String(err)}`,
        503,
      );
    }

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new IngestionServiceError(
        `NLP service returned ${response.status}: ${body}`,
        response.status,
        body,
      );
    }

    const data: IngestionResponse = await response.json();

    // Handle quality issues
    if (data.quality.needs_human_review) {
      await this.createReviewTask(data);
    }

    return data;
  }

  /**
   * Create a review task for human follow-up when quality issues are found.
   *
   * In production this would create a Jira ticket or internal task.
   * For now it logs the review request.
   */
  private async createReviewTask(data: IngestionResponse): Promise<void> {
    const { result, quality } = data;
    console.warn(
      `[IngestionService] Human review needed for ${result.s3_key}:`,
      quality.review_reasons.join(", "),
    );
    // TODO: integrate with Jira/task system
    // await jiraClient.createIssue({
    //   summary: `Review ingestion: ${result.metadata.contract_number ?? result.s3_key}`,
    //   description: quality.review_reasons.join("\n"),
    //   labels: ["ingestion-review"],
    // });
  }
}
