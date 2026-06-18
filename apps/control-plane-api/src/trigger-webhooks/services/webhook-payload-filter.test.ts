import { BadRequestError } from "@mistle/http/errors.js";
import { describe, expect, it } from "vitest";

import { normalizeWebhookTriggerEventConditions } from "./webhook-payload-filter.js";

describe("normalizeWebhookTriggerEventConditions", () => {
  it("requires at least one event condition", () => {
    expect(() => normalizeWebhookTriggerEventConditions([])).toThrow(BadRequestError);
  });

  it("omits empty condition payload filters", () => {
    expect(
      normalizeWebhookTriggerEventConditions([
        {
          eventType: "github.issue_comment.created",
          payloadFilter: {},
        },
      ]),
    ).toEqual([
      {
        eventType: "github.issue_comment.created",
      },
    ]);
  });

  it("accepts valid condition payload filters", () => {
    expect(
      normalizeWebhookTriggerEventConditions([
        {
          eventType: "github.issue_comment.created",
          payloadFilter: {
            op: "contains_token",
            path: ["comment", "body"],
            value: "@mistlebot",
          },
        },
      ]),
    ).toEqual([
      {
        eventType: "github.issue_comment.created",
        payloadFilter: {
          op: "contains_token",
          path: ["comment", "body"],
          value: "@mistlebot",
        },
      },
    ]);
  });

  it("rejects invalid condition payload filters", () => {
    let thrownError: unknown;

    try {
      normalizeWebhookTriggerEventConditions([
        {
          eventType: "github.issue_comment.created",
          payloadFilter: {
            op: "not_real",
            path: ["action"],
            value: "created",
          },
        },
      ]);
    } catch (error) {
      thrownError = error;
    }

    expect(thrownError).toBeInstanceOf(BadRequestError);
    if (!(thrownError instanceof BadRequestError)) {
      throw new Error("Expected invalid payload filter to throw a bad request error.");
    }

    expect(thrownError.code).toBe("VALIDATION_ERROR");
    expect(thrownError.message).toContain("Invalid eventConditions payloadFilter");
  });
});
