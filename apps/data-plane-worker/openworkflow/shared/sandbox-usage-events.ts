import {
  SandboxInstanceProviders,
  SandboxStorageProviders,
  SandboxUsageEventTypes,
  type DataPlaneDatabase,
  type DataPlaneTables,
} from "@mistle/db/data-plane";
import type { Clock } from "@mistle/time";
import { z } from "zod";

const WorkerSandboxUsageEventInputSchema = z
  .object({
    idempotencyKey: z.string().min(1),
    organizationId: z.string().min(1),
    sandboxInstanceId: z.string().min(1),
    computeGeneration: z.number().int().positive().nullable(),
    eventType: z.enum(SandboxUsageEventTypes),
    runtimeProvider: z.enum(SandboxInstanceProviders).nullable(),
    providerSandboxId: z.string().min(1).nullable(),
    storageProvider: z.enum(SandboxStorageProviders).nullable(),
    providerStorageId: z.string().min(1).nullable(),
    vcpuCount: z.number().int().positive().nullable(),
    memoryMb: z.number().int().positive().nullable(),
    storageMb: z.number().int().positive().nullable(),
    payload: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();

export type WorkerSandboxUsageEventInput = z.input<typeof WorkerSandboxUsageEventInputSchema>;

export type WorkerSandboxUsageEventWriteResult = {
  inserted: boolean;
};

export async function recordWorkerSandboxUsageEvent(
  ctx: {
    clock: Clock;
    db: DataPlaneDatabase;
    tables: Pick<DataPlaneTables, "sandboxUsageEvents">;
  },
  input: WorkerSandboxUsageEventInput,
): Promise<WorkerSandboxUsageEventWriteResult> {
  const parsedInput = WorkerSandboxUsageEventInputSchema.parse(input);

  const insertedRows = await ctx.db
    .insert(ctx.tables.sandboxUsageEvents)
    .values({
      idempotencyKey: parsedInput.idempotencyKey,
      organizationId: parsedInput.organizationId,
      sandboxInstanceId: parsedInput.sandboxInstanceId,
      computeGeneration: parsedInput.computeGeneration,
      eventType: parsedInput.eventType,
      occurredAt: ctx.clock.nowDate().toISOString(),
      runtimeProvider: parsedInput.runtimeProvider,
      providerSandboxId: parsedInput.providerSandboxId,
      storageProvider: parsedInput.storageProvider,
      providerStorageId: parsedInput.providerStorageId,
      vcpuCount: parsedInput.vcpuCount,
      memoryMb: parsedInput.memoryMb,
      storageMb: parsedInput.storageMb,
      payload: parsedInput.payload,
    })
    .onConflictDoNothing({
      target: ctx.tables.sandboxUsageEvents.idempotencyKey,
    })
    .returning({
      id: ctx.tables.sandboxUsageEvents.id,
    });

  return {
    inserted: insertedRows.length === 1,
  };
}
