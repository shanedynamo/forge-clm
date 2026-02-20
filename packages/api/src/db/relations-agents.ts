import { relations } from "drizzle-orm";
import { agentRegistry, agentTasks, agentContext } from "./schema-agents.js";

export const agentRegistryRelations = relations(agentRegistry, ({ many }) => ({
  tasks: many(agentTasks),
}));

export const agentTasksRelations = relations(agentTasks, ({ one, many }) => ({
  agent: one(agentRegistry, {
    fields: [agentTasks.agentId],
    references: [agentRegistry.id],
  }),
  contextSteps: many(agentContext),
}));

export const agentContextRelations = relations(agentContext, ({ one }) => ({
  task: one(agentTasks, {
    fields: [agentContext.taskId],
    references: [agentTasks.id],
  }),
}));
