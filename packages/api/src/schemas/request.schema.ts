import { z } from "zod";

export const createRequestSchema = z.object({
  requestType: z.enum(["NDA", "MOU", "NEW_CONTRACT", "MOD", "OPTION_EXERCISE", "FUNDING_ACTION", "TASK_ASSIGNMENT", "SUB_MOD"]),
  requesterName: z.string().min(1).max(255),
  requesterEmail: z.string().email().max(255),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).default("MEDIUM"),
  jiraTicketId: z.string().max(100).optional(),
  detailsJson: z.record(z.unknown()).optional(),
  status: z.string().max(50).default("OPEN"),
});

export const updateRequestSchema = createRequestSchema.partial();
