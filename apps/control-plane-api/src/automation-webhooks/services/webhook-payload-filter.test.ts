import { BadRequestError } from "@mistle/http/errors.js";
import { describe, expect, it } from "vitest";

import {
  assertEventScopedWebhookPayloadFilterOrThrow,
  normalizeWebhookPayloadFilter,
} from "./webhook-payload-filter.js";

describe("webhook payload filter helpers", () => {
  it("normalizes an empty payload filter object to null", () => {
    expect(normalizeWebhookPayloadFilter({})).toBeNull();
  });

  it("accepts event-scoped payload filters when keys are selected", () => {
    expect(() =>
      assertEventScopedWebhookPayloadFilterOrThrow({
        eventTypes: ["github.issue_comment.created"],
        payloadFilter: {
          "github.issue_comment.created": {
            op: "contains_token",
            path: ["comment", "body"],
            value: "@mistlebot",
          },
        },
      }),
    ).not.toThrow();
  });

  it("rejects legacy flat payload filter objects", () => {
    let thrownError: unknown;

    try {
      assertEventScopedWebhookPayloadFilterOrThrow({
        eventTypes: ["github.issue_comment.created"],
        payloadFilter: {
          op: "eq",
          path: ["action"],
          value: "created",
        },
      });
    } catch (error) {
      thrownError = error;
    }

    expect(thrownError).toBeInstanceOf(BadRequestError);
    if (!(thrownError instanceof BadRequestError)) {
      throw new Error("Expected invalid payload filter to throw a bad request error.");
    }

    expect(thrownError.code).toBe("VALIDATION_ERROR");
    expect(thrownError.message).toContain("Invalid payloadFilter");
  });

  it("rejects event-scoped payload filters for unselected event types", () => {
    let thrownError: unknown;

    try {
      assertEventScopedWebhookPayloadFilterOrThrow({
        eventTypes: ["github.issue_comment.created"],
        payloadFilter: {
          "github.pull_request.opened": {
            op: "eq",
            path: ["action"],
            value: "opened",
          },
        },
      });
    } catch (error) {
      thrownError = error;
    }

    expect(thrownError).toBeInstanceOf(BadRequestError);
    if (!(thrownError instanceof BadRequestError)) {
      throw new Error("Expected mismatched event payload filter to throw a bad request error.");
    }

    expect(thrownError.code).toBe("VALIDATION_ERROR");
    expect(thrownError.message).toContain("not selected");
  });
});
