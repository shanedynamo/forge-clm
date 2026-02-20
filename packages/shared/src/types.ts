import { z } from "zod";

export const ContractStatus = z.enum([
  "draft",
  "in_review",
  "pending_approval",
  "approved",
  "active",
  "expired",
  "terminated",
]);
export type ContractStatus = z.infer<typeof ContractStatus>;

export const ContractSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1).max(500),
  description: z.string().optional(),
  status: ContractStatus,
  metadata: z.record(z.unknown()).optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Contract = z.infer<typeof ContractSchema>;

export const DocumentSchema = z.object({
  id: z.string().uuid(),
  contractId: z.string().uuid(),
  filename: z.string(),
  s3Key: z.string(),
  mimeType: z.string().optional(),
  createdAt: z.string().datetime(),
});
export type Document = z.infer<typeof DocumentSchema>;
