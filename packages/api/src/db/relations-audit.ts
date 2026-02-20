import { relations } from "drizzle-orm";
import { approvalQueue } from "./schema.js";
import { approvalAudit } from "./schema-audit.js";

export const approvalAuditRelations = relations(approvalAudit, ({ one }) => ({
  approvalQueueItem: one(approvalQueue, {
    fields: [approvalAudit.approvalQueueId],
    references: [approvalQueue.id],
  }),
}));
