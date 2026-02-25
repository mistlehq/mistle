import { describe, expect, it } from "vitest";

import {
  KeysetPaginationDirections,
  KeysetPaginationInputError,
  KeysetPaginationInputErrorReasons,
  paginateKeyset,
} from "./engine.js";

type Item = {
  id: string;
  rank: number;
};

const DescendingItems: Item[] = [
  { id: "item_5", rank: 5 },
  { id: "item_4", rank: 4 },
  { id: "item_3", rank: 3 },
  { id: "item_2", rank: 2 },
  { id: "item_1", rank: 1 },
];

const AscendingItems = [...DescendingItems].reverse();

function decodeRankCursor(encodedCursor: string): { rank: number } {
  const rank = Number.parseInt(encodedCursor, 10);

  if (!Number.isInteger(rank)) {
    throw new Error("Invalid rank cursor.");
  }

  return { rank };
}

describe("paginateKeyset", () => {
  it("returns the first forward page and next cursor", async () => {
    const result = await paginateKeyset<Item, { rank: number }>({
      query: {},
      pageSize: 2,
      decodeCursor: ({ encodedCursor }) => decodeRankCursor(encodedCursor),
      encodeCursor: (cursor) => String(cursor.rank),
      getCursor: (item) => ({ rank: item.rank }),
      fetchPage: async ({ direction, cursor, limitPlusOne }) => {
        expect(direction).toBe(KeysetPaginationDirections.FORWARD);
        expect(cursor).toBeUndefined();
        expect(limitPlusOne).toBe(3);
        return DescendingItems.slice(0, limitPlusOne);
      },
      countTotalResults: async () => 5,
    });

    expect(result.totalResults).toBe(5);
    expect(result.items.map((item) => item.id)).toEqual(["item_5", "item_4"]);
    expect(result.nextPage).toEqual({
      after: "4",
      limit: 2,
    });
    expect(result.previousPage).toBeNull();
  });

  it("returns forward page from `after` cursor with previous cursor", async () => {
    const result = await paginateKeyset<Item, { rank: number }>({
      query: {
        after: "4",
      },
      pageSize: 2,
      decodeCursor: ({ encodedCursor }) => decodeRankCursor(encodedCursor),
      encodeCursor: (cursor) => String(cursor.rank),
      getCursor: (item) => ({ rank: item.rank }),
      fetchPage: async ({ direction, cursor, limitPlusOne }) => {
        expect(direction).toBe(KeysetPaginationDirections.FORWARD);
        if (cursor === undefined) {
          throw new Error("Expected after cursor.");
        }

        const filtered = DescendingItems.filter((item) => item.rank < cursor.rank);
        return filtered.slice(0, limitPlusOne);
      },
      countTotalResults: async () => 5,
    });

    expect(result.items.map((item) => item.id)).toEqual(["item_3", "item_2"]);
    expect(result.nextPage).toEqual({
      after: "2",
      limit: 2,
    });
    expect(result.previousPage).toEqual({
      before: "3",
      limit: 2,
    });
  });

  it("returns backward page from `before` cursor", async () => {
    const result = await paginateKeyset<Item, { rank: number }>({
      query: {
        before: "2",
      },
      pageSize: 2,
      decodeCursor: ({ encodedCursor }) => decodeRankCursor(encodedCursor),
      encodeCursor: (cursor) => String(cursor.rank),
      getCursor: (item) => ({ rank: item.rank }),
      fetchPage: async ({ direction, cursor, limitPlusOne }) => {
        expect(direction).toBe(KeysetPaginationDirections.BACKWARD);
        if (cursor === undefined) {
          throw new Error("Expected before cursor.");
        }

        const filtered = AscendingItems.filter((item) => item.rank > cursor.rank);
        return filtered.slice(0, limitPlusOne);
      },
      countTotalResults: async () => 5,
    });

    expect(result.items.map((item) => item.id)).toEqual(["item_4", "item_3"]);
    expect(result.nextPage).toEqual({
      after: "3",
      limit: 2,
    });
    expect(result.previousPage).toEqual({
      before: "4",
      limit: 2,
    });
  });

  it("throws typed input error when both cursors are provided", async () => {
    await expect(async () =>
      paginateKeyset<Item, { rank: number }>({
        query: {
          after: "4",
          before: "2",
        },
        pageSize: 2,
        decodeCursor: ({ encodedCursor }) => decodeRankCursor(encodedCursor),
        encodeCursor: (cursor) => String(cursor.rank),
        getCursor: (item) => ({ rank: item.rank }),
        fetchPage: async () => [],
        countTotalResults: async () => 0,
      }),
    ).rejects.toMatchObject({
      name: KeysetPaginationInputError.name,
      reason: KeysetPaginationInputErrorReasons.BOTH_CURSORS_PROVIDED,
    } satisfies Pick<KeysetPaginationInputError, "name" | "reason">);
  });
});
