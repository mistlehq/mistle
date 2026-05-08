import { z } from "zod";

const DurableStepErrorSchema = z.looseObject({
  name: z.literal("StepError"),
  stepFailedAttempts: z.number().int().nonnegative(),
  retryPolicy: z.looseObject({
    maximumAttempts: z.number().int().positive(),
  }),
});

export function shouldRethrowDurableStepErrorForRetry(error: unknown): boolean {
  const parsed = DurableStepErrorSchema.safeParse(error);
  if (!parsed.success) {
    return false;
  }

  return parsed.data.stepFailedAttempts < parsed.data.retryPolicy.maximumAttempts;
}
