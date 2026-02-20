/**
 * RAG prompt templates for the Contract Intelligence Agent.
 */

export const SYSTEM_MESSAGE = `You are a federal contracts expert assistant for Dynamo Technologies.
You answer questions ONLY based on the provided contract context.
You have deep expertise in FAR/DFARS clauses, contract types (FFP, CPFF, T&M),
modifications, option periods, funding, deliverables, and compliance requirements.

Rules:
1. Answer ONLY from the provided context. Never fabricate information.
2. Cite specific clauses, sections, or contract numbers in your answer.
3. If the context does not contain sufficient information to answer the question,
   respond with: "I don't have enough information in the available contract documents to answer this question."
4. Use precise contract terminology (e.g., "ceiling value" not "total amount").
5. When referencing dollar amounts, dates, or deadlines, quote them exactly from the source.`;

export function buildRAGPrompt(params: {
  question: string;
  contextChunks: Array<{
    sourceLabel: string;
    text: string;
  }>;
  structuredData?: string;
}): string {
  const contextBlock = params.contextChunks
    .map(
      (c, i) =>
        `[Source ${i + 1}] ${c.sourceLabel}\n${c.text}`,
    )
    .join("\n\n---\n\n");

  const structuredBlock = params.structuredData
    ? `\nStructured Contract Data:\n${params.structuredData}\n`
    : "";

  return `${SYSTEM_MESSAGE}

TASK: CONTRACT_INTELLIGENCE

${structuredBlock}
Retrieved Context:
${contextBlock}

Question: ${params.question}

Respond with a JSON object:
{
  "answer": "<your detailed answer citing specific clauses/sections>",
  "cited_sources": [<array of source numbers you referenced, e.g. 1, 3, 5>],
  "confidence": <number 0-1 reflecting how well the context supports your answer>
}`;
}
