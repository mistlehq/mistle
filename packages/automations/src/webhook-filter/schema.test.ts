import { describe, expect, it } from "vitest";

import { parseWebhookPayloadFilter, WebhookPayloadFilterSchema } from "./index.js";

describe("webhook filter schema", () => {
  it("parses valid nested filters", () => {
    const parsedFilter = parseWebhookPayloadFilter({
      op: "and",
      filters: [
        {
          op: "eq",
          path: ["action"],
          value: "created",
        },
        {
          op: "contains",
          path: ["comment", "body"],
          value: "@mistlebot",
        },
      ],
    });

    expect(parsedFilter.op).toBe("and");
    if (parsedFilter.op === "and") {
      expect(parsedFilter.filters).toHaveLength(2);
      return;
    }

    throw new Error("Expected op to be and");
  });

  it("normalizes legacy all and any aliases to and and or", () => {
    const parsedAll = parseWebhookPayloadFilter({
      op: "all",
      filters: [
        {
          op: "eq",
          path: ["action"],
          value: "created",
        },
      ],
    });
    const parsedAny = parseWebhookPayloadFilter({
      op: "any",
      filters: [
        {
          op: "eq",
          path: ["action"],
          value: "created",
        },
      ],
    });

    expect(parsedAll.op).toBe("and");
    expect(parsedAny.op).toBe("or");
  });

  it("rejects string-based paths to enforce array segment paths", () => {
    const parsedFilter = WebhookPayloadFilterSchema.safeParse({
      op: "eq",
      path: "comment.body",
      value: "@mistlebot",
    });

    expect(parsedFilter.success).toBe(false);
  });
});
