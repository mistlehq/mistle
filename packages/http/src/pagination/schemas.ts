import { z } from "zod";

type KeysetPaginationSchemaOptions = {
  defaultLimit?: number;
  maxLimit?: number;
};

function getPaginationLimits(options: KeysetPaginationSchemaOptions | undefined): {
  defaultLimit: number;
  maxLimit: number;
} {
  const defaultLimit = options?.defaultLimit ?? 20;
  const maxLimit = options?.maxLimit ?? 100;

  if (!Number.isInteger(defaultLimit) || defaultLimit < 1) {
    throw new Error("Keyset pagination `defaultLimit` must be an integer greater than 0.");
  }

  if (!Number.isInteger(maxLimit) || maxLimit < 1) {
    throw new Error("Keyset pagination `maxLimit` must be an integer greater than 0.");
  }

  if (defaultLimit > maxLimit) {
    throw new Error("Keyset pagination `defaultLimit` must be less than or equal to `maxLimit`.");
  }

  return {
    defaultLimit,
    maxLimit,
  };
}

export function createKeysetPaginationQuerySchema(options?: KeysetPaginationSchemaOptions) {
  const { defaultLimit, maxLimit } = getPaginationLimits(options);

  return z
    .object({
      limit: z.coerce.number().int().min(1).max(maxLimit).default(defaultLimit),
      after: z.string().min(1).optional(),
      before: z.string().min(1).optional(),
    })
    .strict()
    .refine((value) => !(value.after !== undefined && value.before !== undefined), {
      message: "Only one of `after` or `before` can be provided.",
    });
}

export function createKeysetPaginationEnvelopeSchema<TItemSchema extends z.ZodType>(
  itemSchema: TItemSchema,
  options?: KeysetPaginationSchemaOptions,
) {
  const { maxLimit } = getPaginationLimits(options);

  const nextPageSchema = z
    .object({
      after: z.string().min(1),
      limit: z.number().int().min(1).max(maxLimit),
    })
    .strict();

  const previousPageSchema = z
    .object({
      before: z.string().min(1),
      limit: z.number().int().min(1).max(maxLimit),
    })
    .strict();

  return z
    .object({
      totalResults: z.number().int().nonnegative(),
      items: z.array(itemSchema),
      nextPage: nextPageSchema.nullable(),
      previousPage: previousPageSchema.nullable(),
    })
    .strict();
}
