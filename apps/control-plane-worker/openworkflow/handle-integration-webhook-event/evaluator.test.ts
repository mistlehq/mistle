import { describe, expect, it } from "vitest";

import { evaluateWebhookPayloadFilter, getWebhookPayloadValueAtPath } from "./evaluator.js";

describe("webhook filter evaluator", () => {
  it("resolves nested values by path segments", () => {
    const value = getWebhookPayloadValueAtPath({
      payload: {
        comment: {
          author: {
            login: "mistlebot",
          },
        },
      },
      path: ["comment", "author", "login"],
    });

    expect(value).toBe("mistlebot");
  });

  it("resolves array values by numeric segment", () => {
    const value = getWebhookPayloadValueAtPath({
      payload: {
        labels: [
          {
            name: "bug",
          },
          {
            name: "urgent",
          },
        ],
      },
      path: ["labels", "1", "name"],
    });

    expect(value).toBe("urgent");
  });

  it("returns false for missing paths with exists", () => {
    const matches = evaluateWebhookPayloadFilter({
      filter: {
        op: "exists",
        path: ["pull_request", "number"],
      },
      payload: {
        issue: {
          number: 42,
        },
      },
    });

    expect(matches).toBe(false);
  });

  it("returns true for missing paths with not_exists", () => {
    const matches = evaluateWebhookPayloadFilter({
      filter: {
        op: "not_exists",
        path: ["pull_request", "number"],
      },
      payload: {
        issue: {
          number: 42,
        },
      },
    });

    expect(matches).toBe(true);
  });

  it("supports all scalar comparisons and string operations", () => {
    const payload = {
      action: "created",
      comment: {
        body: "hello @mistlebot",
      },
      attempts: 3,
      archived: false,
    };

    const matches = evaluateWebhookPayloadFilter({
      filter: {
        op: "and",
        filters: [
          {
            op: "eq",
            path: ["action"],
            value: "created",
          },
          {
            op: "neq",
            path: ["attempts"],
            value: 2,
          },
          {
            op: "in",
            path: ["attempts"],
            values: [1, 2, 3],
          },
          {
            op: "in",
            path: ["archived"],
            values: [false],
          },
          {
            op: "contains",
            path: ["comment", "body"],
            value: "@mistlebot",
          },
          {
            op: "contains_token",
            path: ["comment", "body"],
            value: "@mistlebot",
          },
          {
            op: "starts_with",
            path: ["comment", "body"],
            value: "hello",
          },
          {
            op: "ends_with",
            path: ["comment", "body"],
            value: "mistlebot",
          },
        ],
      },
      payload,
    });

    expect(matches).toBe(true);
  });

  it("matches token boundaries for contains_token", () => {
    expect(
      evaluateWebhookPayloadFilter({
        filter: {
          op: "contains_token",
          path: ["comment", "body"],
          value: "@mistlebot",
        },
        payload: {
          comment: {
            body: "@mistlebot, please review",
          },
        },
      }),
    ).toBe(true);

    expect(
      evaluateWebhookPayloadFilter({
        filter: {
          op: "contains_token",
          path: ["comment", "body"],
          value: "@mistlebot",
        },
        payload: {
          comment: {
            body: "@mistlebot- please review",
          },
        },
      }),
    ).toBe(true);

    expect(
      evaluateWebhookPayloadFilter({
        filter: {
          op: "contains_token",
          path: ["comment", "body"],
          value: "@mistlebot",
        },
        payload: {
          comment: {
            body: "@mistlebota please review",
          },
        },
      }),
    ).toBe(false);

    expect(
      evaluateWebhookPayloadFilter({
        filter: {
          op: "contains_token",
          path: ["comment", "body"],
          value: "@mistlebot",
        },
        payload: {
          comment: {
            body: "@mistleboté please review",
          },
        },
      }),
    ).toBe(false);

    expect(
      evaluateWebhookPayloadFilter({
        filter: {
          op: "contains_token",
          path: ["comment", "body"],
          value: "@mistlebot",
        },
        payload: {
          comment: {
            body: "@mistlebot前 please review",
          },
        },
      }),
    ).toBe(false);

    expect(
      evaluateWebhookPayloadFilter({
        filter: {
          op: "contains_token",
          path: ["comment", "body"],
          value: "@mistlebot",
        },
        payload: {
          comment: {
            body: "@mistlebot𐐀 please review",
          },
        },
      }),
    ).toBe(false);

    expect(
      evaluateWebhookPayloadFilter({
        filter: {
          op: "contains_token",
          path: ["comment", "body"],
          value: "@mistlebot",
        },
        payload: {
          comment: {
            body: "@mistlebot𝟘 please review",
          },
        },
      }),
    ).toBe(false);
  });

  it("supports or and not composition", () => {
    const matches = evaluateWebhookPayloadFilter({
      filter: {
        op: "or",
        filters: [
          {
            op: "eq",
            path: ["action"],
            value: "opened",
          },
          {
            op: "not",
            filter: {
              op: "contains",
              path: ["comment", "body"],
              value: "ignore",
            },
          },
        ],
      },
      payload: {
        action: "created",
        comment: {
          body: "ship it",
        },
      },
    });

    expect(matches).toBe(true);
  });
});
