/**
 * TemplateEngine — processes document templates with placeholder
 * replacement, conditional sections, and repeating sections.
 *
 * Templates use {{placeholder}} tokens:
 *   {{fieldName}}                       — simple text replacement
 *   {{#if fieldName}}...{{/if}}         — conditional section
 *   {{#each arrayField}}...{{/each}}    — repeating section (tables)
 *
 * Inside {{#each}} blocks, use {{fieldName}} to reference item fields.
 */

// ─── Types ───────────────────────────────────────────────────────────

export interface Template {
  name: string;
  content: string;
}

// ─── Starter templates ───────────────────────────────────────────────

export const STARTER_TEMPLATES: Record<string, string> = {
  "nda_mutual.docx": `MUTUAL NON-DISCLOSURE AGREEMENT

This Mutual Non-Disclosure Agreement ("Agreement") is entered into as of {{effectiveDate}} ("Effective Date") by and between:

Party 1: {{party1Name}}, located at {{party1Address}} ("Party 1"); and
Party 2: {{party2Name}}, located at {{party2Address}} ("Party 2").

(Collectively, the "Parties")

1. PURPOSE
The Parties wish to exchange confidential information regarding {{scope}}.

2. CONFIDENTIAL INFORMATION
Both Parties agree to hold all Confidential Information in strict confidence and to not disclose such information to any third party without prior written consent.

3. TERM
This Agreement shall remain in effect from the Effective Date until {{expirationDate}}.

{{#if governmentContract}}
4. GOVERNMENT CONTRACT ASSOCIATION
This NDA is executed in connection with Contract {{contractNumber}} with {{awardingAgency}}.
{{/if}}

IN WITNESS WHEREOF, the Parties have executed this Agreement as of the date first above written.

{{party1Name}}                    {{party2Name}}
Signature: _______________        Signature: _______________`,

  "nda_unilateral.docx": `UNILATERAL NON-DISCLOSURE AGREEMENT

This Non-Disclosure Agreement ("Agreement") is entered into as of {{effectiveDate}} ("Effective Date") by:

Disclosing Party: {{disclosingPartyName}}, located at {{disclosingPartyAddress}}
Receiving Party: {{receivingPartyName}}, located at {{receivingPartyAddress}}

1. PURPOSE
The Disclosing Party wishes to disclose confidential information regarding {{scope}}.

2. OBLIGATIONS
The Receiving Party agrees to protect all Confidential Information received from the Disclosing Party and to not disclose such information without prior written consent.

3. TERM
This Agreement shall remain in effect from the Effective Date until {{expirationDate}}.

{{#if governmentContract}}
4. GOVERNMENT CONTRACT ASSOCIATION
This NDA is executed in connection with Contract {{contractNumber}}.
{{/if}}

Disclosing Party: {{disclosingPartyName}}
Receiving Party: {{receivingPartyName}}
Signature: _______________        Signature: _______________`,

  "mou.docx": `MEMORANDUM OF UNDERSTANDING

This Memorandum of Understanding ("MOU") is entered into as of {{effectiveDate}} by and between:

{{#each parties}}
- {{name}}, Role: {{role}}
{{/each}}

1. PURPOSE
{{purpose}}

2. RESPONSIBILITIES AND OBLIGATIONS
{{obligations}}

3. DURATION
This MOU is effective from {{effectiveDate}} through {{expirationDate}}.

4. POINTS OF CONTACT
{{#each parties}}
{{name}}: {{contactName}} ({{contactEmail}})
{{/each}}

IN WITNESS WHEREOF, the undersigned have executed this MOU as of the date first above written.`,

  "option_exercise_letter.docx": `OPTION EXERCISE LETTER

Date: {{currentDate}}
Contract Number: {{contractNumber}}
Contracting Officer: {{contractingOfficer}}
Contractor: Dynamo Technologies, Inc.

RE: Exercise of Option {{optionNumber}}

Dear {{contractingOfficer}},

Pursuant to the terms of Contract {{contractNumber}}, this letter serves as {{#if exerciseRequested}}a request to exercise{{/if}}{{#if notificationOnly}}notification regarding{{/if}} Option {{optionNumber}}.

Option Details:
- Option Number: {{optionNumber}}
- Option Period: {{optionStart}} through {{optionEnd}}
- Option Value: \${{optionValue}}
- Exercise Deadline: {{exerciseBy}}

Current Contract Status:
- Ceiling Value: \${{ceilingValue}}
- Funded Value: \${{fundedValue}}

{{#if exerciseRequested}}
Dynamo Technologies hereby requests exercise of the above option in accordance with the contract terms.
{{/if}}

Respectfully,
Dynamo Technologies, Inc.`,

  "funding_action_request.docx": `FUNDING ACTION REQUEST

Date: {{currentDate}}
Contract Number: {{contractNumber}}
Agency: {{awardingAgency}}

1. CURRENT FUNDING STATUS
- Contract Ceiling: \${{ceilingValue}}
- Currently Funded: \${{fundedValue}}
- Ceiling Remaining: \${{ceilingRemaining}}

2. FUNDING REQUESTED
Amount: \${{requestedAmount}}
Justification: {{justification}}

3. CLIN DETAIL
{{#each clins}}
CLIN {{clinNumber}}: {{description}}
  Funded: \${{fundedAmount}} / Total: \${{totalValue}}
{{/each}}

4. PERIOD OF PERFORMANCE
{{popStart}} through {{popEnd}}

Submitted by: {{requesterName}}`,

  "mod_cover_letter.docx": `MODIFICATION COVER LETTER

Date: {{currentDate}}
Contract Number: {{contractNumber}}
Modification Number: {{modNumber}}
Agency: {{awardingAgency}}
Contracting Officer: {{contractingOfficer}}

RE: {{modType}} Modification — {{modNumber}}

Dear {{contractingOfficer}},

1. SUMMARY OF CHANGES
{{description}}

2. EFFECTIVE DATE
{{effectiveDate}}

3. FINANCIAL IMPACT
- Ceiling Change: \${{ceilingDelta}}
- Funding Change: \${{fundingDelta}}

{{#if sf30Reference}}
4. SF-30 REFERENCE
{{sf30Reference}}
{{/if}}

Respectfully,
Dynamo Technologies, Inc.`,
};

// ─── TemplateEngine ──────────────────────────────────────────────────

export class TemplateEngine {
  private templates: Map<string, string>;

  constructor(templates?: Record<string, string>) {
    this.templates = new Map(
      Object.entries(templates ?? STARTER_TEMPLATES),
    );
  }

  /**
   * Load a template by name. Returns null if not found.
   */
  loadTemplate(name: string): Template | null {
    const content = this.templates.get(name);
    if (!content) return null;
    return { name, content };
  }

  /**
   * Populate a template with data. Processes conditionals, loops,
   * then simple placeholder replacement.
   */
  populate(template: Template, data: Record<string, unknown>): string {
    let content = template.content;
    content = this.processConditionals(content, data);
    content = this.processLoops(content, data);
    content = this.processReplacements(content, data);
    return content;
  }

  /**
   * Find placeholder tokens that remain unresolved after populate().
   */
  findUnresolvedTokens(content: string): string[] {
    const re = /\{\{(\w+(?:\.\w+)*)\}\}/g;
    const tokens: string[] = [];
    let match;
    while ((match = re.exec(content)) !== null) {
      tokens.push(match[1]!);
    }
    return [...new Set(tokens)];
  }

  // ── Internals ────────────────────────────────────────────────────

  private processConditionals(
    content: string,
    data: Record<string, unknown>,
  ): string {
    return content.replace(
      /\{\{#if\s+(\w+(?:\.\w+)*)\}\}([\s\S]*?)\{\{\/if\}\}/g,
      (_match, field: string, body: string) => {
        const value = this.resolve(data, field);
        return value ? body : "";
      },
    );
  }

  private processLoops(
    content: string,
    data: Record<string, unknown>,
  ): string {
    return content.replace(
      /\{\{#each\s+(\w+(?:\.\w+)*)\}\}([\s\S]*?)\{\{\/each\}\}/g,
      (_match, field: string, body: string) => {
        const items = this.resolve(data, field);
        if (!Array.isArray(items)) return "";
        return items
          .map((item: Record<string, unknown>) => {
            return body.replace(
              /\{\{(?:this\.)?(\w+(?:\.\w+)*)\}\}/g,
              (_m, key: string) =>
                String(this.resolve(item, key) ?? ""),
            );
          })
          .join("");
      },
    );
  }

  private processReplacements(
    content: string,
    data: Record<string, unknown>,
  ): string {
    return content.replace(
      /\{\{(\w+(?:\.\w+)*)\}\}/g,
      (_match, field: string) => {
        const value = this.resolve(data, field);
        return value !== undefined && value !== null
          ? String(value)
          : `{{${field}}}`;
      },
    );
  }

  private resolve(data: unknown, path: string): unknown {
    return path
      .split(".")
      .reduce(
        (obj: any, key: string) => obj?.[key],
        data,
      );
  }
}
