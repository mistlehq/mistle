import { z } from "zod";

const NonEmptyStringSchema = z.string().min(1);

const DetachedWorkLeaseOpenSchema = z.object({
  type: z.literal("detached_work.lease.open"),
  leaseId: NonEmptyStringSchema,
  kind: NonEmptyStringSchema,
  protocolFamily: NonEmptyStringSchema,
  externalExecutionId: NonEmptyStringSchema.optional(),
});

const DetachedWorkLeaseRenewSchema = z.object({
  type: z.literal("detached_work.lease.renew"),
  leaseId: NonEmptyStringSchema,
  kind: NonEmptyStringSchema,
  protocolFamily: NonEmptyStringSchema,
  externalExecutionId: NonEmptyStringSchema.optional(),
});

const DetachedWorkLeaseControlMessageSchema = z.discriminatedUnion("type", [
  DetachedWorkLeaseOpenSchema,
  DetachedWorkLeaseRenewSchema,
]);

export type DetachedWorkLeaseOpen = z.infer<typeof DetachedWorkLeaseOpenSchema>;
export type DetachedWorkLeaseRenew = z.infer<typeof DetachedWorkLeaseRenewSchema>;
export type DetachedWorkLeaseControlMessage = z.infer<typeof DetachedWorkLeaseControlMessageSchema>;

export function parseDetachedWorkLeaseControlMessage(
  payload: string,
): DetachedWorkLeaseControlMessage | undefined {
  let parsedPayload: unknown;
  try {
    parsedPayload = JSON.parse(payload);
  } catch {
    return undefined;
  }

  const result = DetachedWorkLeaseControlMessageSchema.safeParse(parsedPayload);
  return result.success ? result.data : undefined;
}
