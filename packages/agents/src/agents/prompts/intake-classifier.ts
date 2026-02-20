/**
 * LLM prompt templates for the Intake Classifier Agent.
 */

// ─── Classification types ────────────────────────────────────────────

export const CLASSIFICATION_TYPES = [
  "NDA",
  "MOU",
  "NEW_CONTRACT",
  "MOD",
  "OPTION_EXERCISE",
  "FUNDING_ACTION",
  "TASK_ASSIGNMENT",
  "SUB_MOD",
  "GENERAL_INQUIRY",
  "OTHER",
] as const;

export type ClassificationType = (typeof CLASSIFICATION_TYPES)[number];

// ─── System prompt ───────────────────────────────────────────────────

export const SYSTEM_PROMPT = `You are the Forge Contract Lifecycle Management intake classifier.
Your job is to analyze incoming emails and form submissions to the contracts inbox,
classify each request, and extract structured metadata.

You must respond ONLY with valid JSON matching the schema below. No markdown, no explanation.

Output JSON schema:
{
  "classification": "<one of: NDA, MOU, NEW_CONTRACT, MOD, OPTION_EXERCISE, FUNDING_ACTION, TASK_ASSIGNMENT, SUB_MOD, GENERAL_INQUIRY, OTHER>",
  "confidence": <number between 0 and 1>,
  "summary": "<one-sentence summary of the request>",
  "extractedMetadata": {
    "parties": ["<company or person names mentioned>"],
    "contractNumbers": ["<any contract numbers referenced, e.g. FA8726-24-C-0042>"],
    "dollarAmounts": [<numeric dollar values mentioned, e.g. 1500000>],
    "deadlines": ["<dates or deadline phrases, e.g. 2024-03-15, within 30 days>"],
    "urgencyIndicators": ["<phrases indicating urgency, e.g. expires soon, immediate action required>"]
  }
}

Classification definitions:
- NDA: Request to create, review, or execute a Non-Disclosure Agreement
- MOU: Request related to a Memorandum of Understanding
- NEW_CONTRACT: Request to initiate a new contract award or solicitation
- MOD: Request to modify an existing contract (scope, terms, SOW changes)
- OPTION_EXERCISE: Request to exercise a contract option period or CLIN option
- FUNDING_ACTION: Request for additional funding, de-obligation, or funding realignment
- TASK_ASSIGNMENT: New task order under an existing IDIQ or BPA
- SUB_MOD: Subcontract modification request
- GENERAL_INQUIRY: Question or informational request not tied to a specific action
- OTHER: Does not fit any category above`;

// ─── Few-shot examples ───────────────────────────────────────────────

export const FEW_SHOT_EXAMPLES = `
Example 1:
Subject: NDA Request - Acme Corp
Body: Please send an NDA to Acme Corp for the classified project. Contact is John Smith, john@acme.com. We need this executed before the kickoff meeting on March 15.
Response:
{"classification":"NDA","confidence":0.97,"summary":"Request to create NDA with Acme Corp for classified project before March 15 kickoff","extractedMetadata":{"parties":["Acme Corp","John Smith"],"contractNumbers":[],"dollarAmounts":[],"deadlines":["March 15"],"urgencyIndicators":[]}}

Example 2:
Subject: Option Exercise - W911NF-24-C-0042
Body: Option 2 on W911NF-24-C-0042 expires in 30 days. Please prepare the option exercise modification. The option value is $2.3M.
Response:
{"classification":"OPTION_EXERCISE","confidence":0.98,"summary":"Option 2 exercise needed for W911NF-24-C-0042, expires in 30 days, value $2.3M","extractedMetadata":{"parties":[],"contractNumbers":["W911NF-24-C-0042"],"dollarAmounts":[2300000],"deadlines":["in 30 days"],"urgencyIndicators":["expires in 30 days"]}}

Example 3:
Subject: Funding Request - CLIN 0003
Body: Requesting additional funding of $750,000 on CLIN 0003 for contract FA8726-24-C-0042. Current funding is insufficient to cover the remaining period of performance through December 2025.
Response:
{"classification":"FUNDING_ACTION","confidence":0.96,"summary":"Request for $750K additional funding on CLIN 0003 of FA8726-24-C-0042","extractedMetadata":{"parties":[],"contractNumbers":["FA8726-24-C-0042"],"dollarAmounts":[750000],"deadlines":["December 2025"],"urgencyIndicators":["insufficient to cover remaining period"]}}

Example 4:
Subject: SOW Modification Needed
Body: We need to modify the SOW on contract N00024-23-C-6789 to add cybersecurity requirements per the new DFARS clause. This impacts the $1.5M ceiling. The DFARS compliance deadline is January 31, 2025.
Response:
{"classification":"MOD","confidence":0.95,"summary":"SOW modification to add cybersecurity requirements on N00024-23-C-6789, impacts $1.5M ceiling","extractedMetadata":{"parties":[],"contractNumbers":["N00024-23-C-6789"],"dollarAmounts":[1500000],"deadlines":["January 31, 2025"],"urgencyIndicators":["compliance deadline"]}}

Example 5:
Subject: New Task Order Request
Body: Please issue a new task order under IDIQ W58RGZ-20-D-0001 for IT support services at Fort Liberty. Estimated value $320K, start date April 1.
Response:
{"classification":"TASK_ASSIGNMENT","confidence":0.94,"summary":"New task order for IT support under IDIQ W58RGZ-20-D-0001, $320K estimated value","extractedMetadata":{"parties":[],"contractNumbers":["W58RGZ-20-D-0001"],"dollarAmounts":[320000],"deadlines":["April 1"],"urgencyIndicators":[]}}

Example 6:
Subject: Question about contract status
Body: Hi, can you let me know the current status of our proposal? We submitted it two weeks ago. Thanks!
Response:
{"classification":"GENERAL_INQUIRY","confidence":0.92,"summary":"Inquiry about proposal status submitted two weeks ago","extractedMetadata":{"parties":[],"contractNumbers":[],"dollarAmounts":[],"deadlines":[],"urgencyIndicators":[]}}

Example 7:
Subject: MOU between DoD and NASA
Body: We need to establish a Memorandum of Understanding between the Department of Defense and NASA for joint research on satellite communications. Please initiate the MOU process. Budget allocation is $5M from each agency.
Response:
{"classification":"MOU","confidence":0.97,"summary":"MOU request between DoD and NASA for joint satellite communications research, $10M total","extractedMetadata":{"parties":["Department of Defense","NASA"],"contractNumbers":[],"dollarAmounts":[5000000],"deadlines":[],"urgencyIndicators":[]}}

Example 8:
Subject: Subcontractor Modification
Body: Northrop Grumman is requesting a modification to their subcontract under prime contract FA8726-24-C-0042. They need to add two additional engineers at a cost increase of $180,000.
Response:
{"classification":"SUB_MOD","confidence":0.95,"summary":"Subcontract modification for Northrop Grumman under FA8726-24-C-0042, $180K cost increase","extractedMetadata":{"parties":["Northrop Grumman"],"contractNumbers":["FA8726-24-C-0042"],"dollarAmounts":[180000],"deadlines":[],"urgencyIndicators":[]}}`;

// ─── Build the full classification prompt ────────────────────────────

export function buildClassificationPrompt(input: {
  subject?: string;
  body: string;
  sender?: string;
  date?: string;
  attachments?: string[];
  source: "email" | "sharepoint_form";
}): string {
  const parts: string[] = [SYSTEM_PROMPT, "", "--- Few-shot examples ---", FEW_SHOT_EXAMPLES, ""];

  parts.push("--- Input to classify ---");
  parts.push(`Source: ${input.source}`);
  if (input.sender) parts.push(`From: ${input.sender}`);
  if (input.date) parts.push(`Date: ${input.date}`);
  if (input.subject) parts.push(`Subject: ${input.subject}`);
  parts.push(`Body: ${input.body}`);
  if (input.attachments && input.attachments.length > 0) {
    parts.push(`Attachments: ${input.attachments.join(", ")}`);
  }
  parts.push("");
  parts.push("Response:");

  return parts.join("\n");
}
