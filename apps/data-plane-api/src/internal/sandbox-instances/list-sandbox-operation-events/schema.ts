import { z } from "@hono/zod-openapi";

const SandboxInstanceReadablePurposeSchema = z.enum([
  "session",
  "designer",
  "snapshot",
  "setup_assistant",
  "setup_check",
  "skills_discovery",
]);

export const ListSandboxOperationEventsParamsSchema = z
  .object({
    id: z.string().min(1),
  })
  .strict();

export const ListSandboxOperationEventsQuerySchema = z
  .object({
    organizationId: z.string().min(1),
    operationId: z.string().min(1),
    allowedPurposes: z
      .string()
      .min(1)
      .transform((value) => value.split(",").filter((purpose) => purpose.length > 0))
      .pipe(z.array(SandboxInstanceReadablePurposeSchema).min(1))
      .optional(),
    afterSequence: z
      .preprocess((rawValue) => {
        if (rawValue === undefined) {
          return undefined;
        }

        if (typeof rawValue === "number") {
          return rawValue;
        }

        if (typeof rawValue === "string") {
          return Number(rawValue);
        }

        return rawValue;
      }, z.number().int().min(0))
      .optional(),
    limit: z
      .preprocess((rawValue) => {
        if (rawValue === undefined) {
          return undefined;
        }

        if (typeof rawValue === "number") {
          return rawValue;
        }

        if (typeof rawValue === "string") {
          return Number(rawValue);
        }

        return rawValue;
      }, z.number().int().min(1).max(500))
      .optional(),
  })
  .strict();

export type ListSandboxOperationEventsInput = z.infer<
  typeof ListSandboxOperationEventsQuerySchema
> & {
  sandboxInstanceId: string;
};
