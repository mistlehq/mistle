import { describe, expect, it } from "vitest";

import { listSessionSidebarGroupsQuerySchema } from "./schemas.js";

describe("listSessionSidebarGroupsQuerySchema", () => {
  it("coerces string query limits from HTTP requests", () => {
    expect(
      listSessionSidebarGroupsQuerySchema.parse({
        limit: "30",
      }),
    ).toStrictEqual({
      limit: 30,
    });
  });

  it("keeps the default limit behavior when limit is omitted", () => {
    expect(listSessionSidebarGroupsQuerySchema.parse({})).toStrictEqual({
      limit: 100,
    });
  });
});
