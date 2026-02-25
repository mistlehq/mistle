import type { KeysetPaginatedResult, KeysetPaginationQuery } from "./types.js";

export const KeysetPaginationDirections = {
  FORWARD: "FORWARD",
  BACKWARD: "BACKWARD",
} as const;

export type KeysetPaginationDirection =
  (typeof KeysetPaginationDirections)[keyof typeof KeysetPaginationDirections];

export const KeysetPaginationInputErrorReasons = {
  BOTH_CURSORS_PROVIDED: "BOTH_CURSORS_PROVIDED",
} as const;

export type KeysetPaginationInputErrorReason =
  (typeof KeysetPaginationInputErrorReasons)[keyof typeof KeysetPaginationInputErrorReasons];

export class KeysetPaginationInputError extends Error {
  reason: KeysetPaginationInputErrorReason;

  constructor(reason: KeysetPaginationInputErrorReason, message: string) {
    super(message);
    this.name = "KeysetPaginationInputError";
    this.reason = reason;
  }
}

export type PaginateKeysetInput<TItem, TCursor> = {
  query: Pick<KeysetPaginationQuery, "after" | "before">;
  pageSize: number;
  decodeCursor: (input: { encodedCursor: string; cursorName: "after" | "before" }) => TCursor;
  encodeCursor: (cursor: TCursor) => string;
  getCursor: (item: TItem) => TCursor;
  fetchPage: (input: {
    direction: KeysetPaginationDirection;
    cursor: TCursor | undefined;
    limitPlusOne: number;
  }) => Promise<TItem[]>;
  countTotalResults: () => Promise<number>;
};

export async function paginateKeyset<TItem, TCursor>(
  input: PaginateKeysetInput<TItem, TCursor>,
): Promise<KeysetPaginatedResult<TItem>> {
  const { query } = input;

  if (query.after !== undefined && query.before !== undefined) {
    throw new KeysetPaginationInputError(
      KeysetPaginationInputErrorReasons.BOTH_CURSORS_PROVIDED,
      "Only one of `after` or `before` can be provided.",
    );
  }

  const afterCursor =
    query.after === undefined
      ? undefined
      : input.decodeCursor({
          encodedCursor: query.after,
          cursorName: "after",
        });
  const beforeCursor =
    query.before === undefined
      ? undefined
      : input.decodeCursor({
          encodedCursor: query.before,
          cursorName: "before",
        });

  const direction =
    beforeCursor === undefined
      ? KeysetPaginationDirections.FORWARD
      : KeysetPaginationDirections.BACKWARD;
  const cursor = beforeCursor ?? afterCursor;
  const limitPlusOne = input.pageSize + 1;

  const [rows, totalResults] = await Promise.all([
    input.fetchPage({
      direction,
      cursor,
      limitPlusOne,
    }),
    input.countTotalResults(),
  ]);

  const hasExtraRow = rows.length > input.pageSize;
  const pagedRows = hasExtraRow ? rows.slice(0, input.pageSize) : rows;
  const items =
    direction === KeysetPaginationDirections.BACKWARD ? [...pagedRows].reverse() : pagedRows;

  if (items.length === 0) {
    return {
      totalResults,
      items,
      nextPage: null,
      previousPage: null,
    };
  }

  const firstItem = items[0];
  const lastItem = items.at(-1);

  if (firstItem === undefined || lastItem === undefined) {
    throw new Error("Expected paginated result to contain at least one item.");
  }

  const nextPage =
    direction === KeysetPaginationDirections.BACKWARD || hasExtraRow
      ? {
          after: input.encodeCursor(input.getCursor(lastItem)),
          limit: input.pageSize,
        }
      : null;

  const previousPage =
    direction === KeysetPaginationDirections.FORWARD && afterCursor !== undefined
      ? {
          before: input.encodeCursor(input.getCursor(firstItem)),
          limit: input.pageSize,
        }
      : direction === KeysetPaginationDirections.BACKWARD && hasExtraRow
        ? {
            before: input.encodeCursor(input.getCursor(firstItem)),
            limit: input.pageSize,
          }
        : null;

  return {
    totalResults,
    items,
    nextPage,
    previousPage,
  };
}
