import { z } from "zod";

export const createNdaSchema = z.object({
  partyAId: z.string().uuid(),
  partyBId: z.string().uuid(),
  effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  expirationDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  ndaType: z.enum(["MUTUAL", "UNILATERAL"]),
  scopeDescription: z.string().optional(),
  status: z.string().max(50).default("REQUESTED"),
});

export const updateNdaSchema = createNdaSchema.partial();
