import { z } from "zod";

export const uuidParam = z.object({
  id: z.string().uuid(),
});

export const transitionBody = z.object({
  toState: z.string().min(1),
});
