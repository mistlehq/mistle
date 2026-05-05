import { z } from "zod";

import { CompiledRuntimePlanSchema } from "./runtime-plan.js";

export const SandboxdEgressGrantRefreshInputSchema = z
  .object({
    runtimePlan: CompiledRuntimePlanSchema,
    egressGrantByRuleId: z.record(z.string(), z.string().min(1)),
  })
  .strict();

export type SandboxdEgressGrantRefreshInput = z.infer<typeof SandboxdEgressGrantRefreshInputSchema>;
