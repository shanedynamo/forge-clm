/**
 * LLM provider abstraction — mock for local dev, Bedrock for production.
 */

// ─── Interfaces ──────────────────────────────────────────────────────

export interface LLMCompletionOptions {
  maxTokens?: number;
  temperature?: number;
  stopSequences?: string[];
}

export interface LLMProvider {
  complete(prompt: string, options?: LLMCompletionOptions): Promise<string>;
  readonly providerName: string;
}

// ─── Mock provider (local dev / testing) ─────────────────────────────

export class MockLLMProvider implements LLMProvider {
  readonly providerName = "mock";

  async complete(prompt: string, _options?: LLMCompletionOptions): Promise<string> {
    // Detect the type of request from the prompt and return structured mock responses
    if (prompt.includes("TASK: SUMMARIZE_CONTRACT")) {
      return JSON.stringify({
        summary:
          "This is a firm-fixed-price contract for engineering services awarded by the US Air Force. " +
          "The contract has a ceiling value with a defined period of performance.",
        key_terms: [
          "Firm-fixed-price",
          "Engineering services",
          "Period of performance",
        ],
        risks: ["Standard FAR clause deviations should be monitored"],
        obligations: [
          "Deliver monthly status reports",
          "Comply with DFARS cybersecurity requirements",
        ],
      });
    }

    if (prompt.includes("TASK: ANALYZE_CLAUSE")) {
      return JSON.stringify({
        risk_level: "MEDIUM",
        deviations: [
          "Clause contains non-standard limitation of liability language",
        ],
        justification:
          "The clause deviates from the standard FAR position by limiting contractor liability. " +
          "This is common in cost-plus contracts but unusual for FFP.",
        recommendations: [
          "Negotiate removal of liability cap",
          "Add mutual indemnification clause",
        ],
      });
    }

    if (prompt.includes("TASK: ANSWER_QUESTION")) {
      return JSON.stringify({
        answer:
          "Based on the contract documents, the relevant information is contained in the referenced sections. " +
          "The contract specifies the terms and conditions as outlined in the cited clauses.",
        confidence: 0.85,
      });
    }

    // Default response
    return JSON.stringify({
      answer: "This is a mock LLM response for testing purposes.",
      confidence: 0.5,
    });
  }
}

// ─── Bedrock provider (production — placeholder) ─────────────────────

export class BedrockLLMProvider implements LLMProvider {
  readonly providerName = "bedrock";

  async complete(prompt: string, options?: LLMCompletionOptions): Promise<string> {
    // TODO: Implement with @aws-sdk/client-bedrock-runtime
    // const client = new BedrockRuntimeClient({ region: "us-east-1" });
    // const response = await client.send(new InvokeModelCommand({ ... }));
    throw new Error(
      "BedrockLLMProvider is not yet implemented. Set LLM_PROVIDER=mock for local development.",
    );
  }
}

// ─── Factory ─────────────────────────────────────────────────────────

export function createLLMProvider(): LLMProvider {
  const provider = process.env["LLM_PROVIDER"] ?? "mock";

  switch (provider) {
    case "bedrock":
      return new BedrockLLMProvider();
    case "mock":
    default:
      return new MockLLMProvider();
  }
}
