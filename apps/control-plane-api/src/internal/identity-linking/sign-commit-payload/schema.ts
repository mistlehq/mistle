import { z } from "@hono/zod-openapi";

function isValidKeyRef(value: string): boolean {
  return value.startsWith("key::") && value.slice("key::".length).trim().length > 0;
}

function isValidBase64Payload(value: string): boolean {
  try {
    return Buffer.from(value, "base64").toString("base64") === value;
  } catch {
    return false;
  }
}

export const SignCommitPayloadRequestSchema = z
  .object({
    organizationId: z.string().min(1),
    sandboxInstanceId: z.string().min(1),
    actingUserId: z.string().min(1),
    providerFamily: z.string().min(1),
    format: z.literal("ssh"),
    keyRef: z.string().min(1).refine(isValidKeyRef, {
      message: "keyRef must be a non-empty key::<public-key> reference.",
    }),
    grant: z.string().min(1),
    payload: z.string().min(1).refine(isValidBase64Payload, {
      message: "payload must be valid base64.",
    }),
    encoding: z.literal("base64"),
  })
  .strict();

export const SignCommitPayloadResponseSchema = z
  .object({
    format: z.literal("ssh"),
    signature: z.string().min(1),
    signatureEncoding: z.literal("pem"),
  })
  .strict();
