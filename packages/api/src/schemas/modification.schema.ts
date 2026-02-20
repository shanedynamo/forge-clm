import { z } from "zod";

const numericString = z.string().regex(/^\d+(\.\d{1,2})?$/).optional();

export const createModificationSchema = z.object({
  contractId: z.string().uuid(),
  modNumber: z.string().min(1).max(50),
  modType: z.enum(["ADMIN", "FUNDING", "SCOPE", "OPTION_EXERCISE", "TERMINATION", "NOVATION", "NAME_CHANGE"]),
  effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  description: z.string().optional(),
  ceilingDelta: numericString,
  fundingDelta: numericString,
  status: z.string().max(50).default("MOD_IDENTIFIED"),
  sf30Reference: z.string().max(100).optional(),
});

export const updateModificationSchema = createModificationSchema.partial();
