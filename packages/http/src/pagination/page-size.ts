import { z } from "zod";

export type KeysetPaginationLimitOptions = {
  defaultLimit?: number;
  maxLimit?: number;
};

export function getKeysetPaginationLimits(options: KeysetPaginationLimitOptions | undefined): {
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

export function createKeysetPageSizeSchema(options?: KeysetPaginationLimitOptions) {
  const { defaultLimit, maxLimit } = getKeysetPaginationLimits(options);

  return z.number().int().min(1).max(maxLimit).optional().default(defaultLimit);
}

export function parseKeysetPageSize(
  limit: number | undefined,
  options?: KeysetPaginationLimitOptions,
): number {
  return createKeysetPageSizeSchema(options).parse(limit);
}
