import { z } from "zod";

import {
  createKeysetPageSizeSchema,
  getKeysetPaginationLimits,
  type KeysetPaginationLimitOptions,
} from "./page-size.js";

export function createKeysetPaginationQuerySchema(options?: KeysetPaginationLimitOptions) {
  return z
    .object({
      limit: z.preprocess((rawValue) => {
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
      }, createKeysetPageSizeSchema(options)),
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
  options?: KeysetPaginationLimitOptions,
) {
  const { maxLimit } = getKeysetPaginationLimits(options);

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
