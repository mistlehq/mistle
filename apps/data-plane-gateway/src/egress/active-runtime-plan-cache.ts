import type { Cache } from "@mistle/cache";
import { SandboxInstanceStatuses, type SandboxInstanceStatus } from "@mistle/db/data-plane";
import {
  CompiledRuntimePlanSchema,
  type CompiledRuntimePlan,
} from "@mistle/sandbox-runtime-contract";
import { z } from "zod";

const ActiveSandboxRuntimePlanRecordSchema = z
  .object({
    organizationId: z.string().min(1),
    providerSandboxId: z.string().min(1).nullable(),
    runtimePlan: CompiledRuntimePlanSchema,
    runtimePlanRevision: z.number().int().positive(),
    sandboxInstanceStatus: z.enum(SandboxInstanceStatuses),
  })
  .strict();

export type ActiveSandboxRuntimePlan = {
  organizationId: string;
  providerSandboxId: string | null;
  runtimePlan: CompiledRuntimePlan;
  runtimePlanRevision: number;
  sandboxInstanceStatus: SandboxInstanceStatus;
};

export interface ActiveSandboxRuntimePlanRepository {
  get(input: { sandboxInstanceId: string }): Promise<ActiveSandboxRuntimePlan | null>;
  set(input: { runtimePlan: ActiveSandboxRuntimePlan; sandboxInstanceId: string }): Promise<void>;
}

export class ActiveSandboxRuntimePlanCache implements ActiveSandboxRuntimePlanRepository {
  public constructor(private readonly cache: Cache) {}

  public async get(input: { sandboxInstanceId: string }): Promise<ActiveSandboxRuntimePlan | null> {
    const serializedRuntimePlan = await this.cache.get(
      buildActiveRuntimePlanCacheKey({
        sandboxInstanceId: input.sandboxInstanceId,
      }),
    );
    if (serializedRuntimePlan === null) {
      return null;
    }

    return ActiveSandboxRuntimePlanRecordSchema.parse(JSON.parse(serializedRuntimePlan));
  }

  public async set(input: {
    runtimePlan: ActiveSandboxRuntimePlan;
    sandboxInstanceId: string;
  }): Promise<void> {
    await this.cache.set(
      buildActiveRuntimePlanCacheKey({
        sandboxInstanceId: input.sandboxInstanceId,
      }),
      JSON.stringify(input.runtimePlan),
    );
  }
}

function buildActiveRuntimePlanCacheKey(input: { sandboxInstanceId: string }): string {
  return `sandbox-runtime-plan:${input.sandboxInstanceId}`;
}
