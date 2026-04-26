import { z } from "@hono/zod-openapi";
import {
  createCodeMessageErrorSchema,
  ValidationErrorResponseSchema,
} from "@mistle/http/errors.js";

export const ClaimSandboxProfileVersionSnapshotJobParamsSchema = z
  .object({
    jobId: z.string().min(1),
  })
  .strict();

export const SandboxProfileVersionSnapshotJobParamsSchema = z
  .object({
    jobId: z.string().min(1),
  })
  .strict();

export const ClaimSandboxProfileVersionSnapshotJobRequestSchema = z
  .object({
    workflowRunId: z.string().min(1),
  })
  .strict();

export const SandboxProfileVersionSnapshotJobCandidateImageSchema = z
  .object({
    provider: z.string().min(1),
    imageId: z.string().min(1),
  })
  .strict();

export const MarkSandboxProfileVersionSnapshotJobSucceededRequestSchema = z
  .object({
    workflowRunId: z.string().min(1),
    image: SandboxProfileVersionSnapshotJobCandidateImageSchema,
  })
  .strict();

export const MarkSandboxProfileVersionSnapshotJobFailedRequestSchema = z
  .object({
    workflowRunId: z.string().min(1),
    errorCode: z.string().min(1),
    errorMessage: z.string().min(1),
  })
  .strict();

export const SandboxProfileVersionSnapshotJobOkResponseSchema = z
  .object({
    status: z.literal("ok"),
  })
  .strict();

export const InternalSandboxProfileVersionSnapshotJobConflictResponseSchema =
  createCodeMessageErrorSchema(
    z.enum(["SNAPSHOT_JOB_STATE_CONFLICT", "SNAPSHOT_JOB_OWNERSHIP_MISMATCH"]),
  );

export const InternalSandboxProfileVersionSnapshotJobNotFoundResponseSchema =
  createCodeMessageErrorSchema(z.literal("SNAPSHOT_JOB_NOT_FOUND"));

export const InternalSandboxProfileVersionSnapshotJobsBadRequestResponseSchema =
  ValidationErrorResponseSchema;
