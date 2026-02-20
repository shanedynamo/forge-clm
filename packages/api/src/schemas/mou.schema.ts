import { z } from "zod";

export const createMouSchema = z.object({
  effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  expirationDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  purpose: z.string().min(1),
  obligationsSummary: z.string().optional(),
  status: z.string().max(50).default("REQUESTED"),
  partyIds: z.array(z.object({
    partyId: z.string().uuid(),
    role: z.string().min(1).max(100),
  })).min(1),
});

export const updateMouSchema = createMouSchema.partial();
