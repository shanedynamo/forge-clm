import { z } from "zod";

const numericString = z.string().regex(/^\d+(\.\d{1,2})?$/, "Must be a numeric string with up to 2 decimal places");

export const createContractSchema = z.object({
  contractNumber: z.string().min(1).max(100),
  contractType: z.enum(["FFP", "CPFF", "T_AND_M", "IDIQ", "BPA", "COST_PLUS", "HYBRID"]),
  awardingAgency: z.string().min(1).max(500),
  contractingOfficerName: z.string().min(1).max(255),
  contractingOfficerEmail: z.string().email().max(255),
  corName: z.string().max(255).optional(),
  corEmail: z.string().email().max(255).optional(),
  popStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  popEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  ceilingValue: numericString,
  fundedValue: numericString,
  naicsCode: z.string().max(6).optional(),
  pscCode: z.string().max(4).optional(),
  securityLevel: z.enum(["UNCLASSIFIED", "CUI", "SECRET", "TOP_SECRET"]).default("UNCLASSIFIED"),
  cageCode: z.string().max(5).optional(),
  dunsUei: z.string().max(13).optional(),
  status: z.string().max(50).default("OPPORTUNITY_IDENTIFIED"),
  description: z.string().optional(),
});

export const updateContractSchema = createContractSchema.partial();
