import { describe, expect, it } from "vitest";

import { putSandboxProfileVersionDraftBodySchema } from "./schemas.js";

describe("putSandboxProfileVersionDraftBodySchema", () => {
  it("rejects malformed associated resource payload filters at the request boundary", () => {
    expect(
      putSandboxProfileVersionDraftBodySchema.safeParse({
        associatedResourceEventRoutingConfig: {
          enabled: true,
          resources: [
            {
              resourceKind: "github.pull_request",
              eventTypes: ["github.pull_request.issue_comment.created"],
              payloadFilter: {
                "github.pull_request.issue_comment.created": {
                  op: "contains_token",
                  path: [],
                  value: "@mistle",
                },
              },
            },
          ],
        },
      }).success,
    ).toBe(false);
  });

  it("rejects associated resource payload filters for unselected event types", () => {
    expect(
      putSandboxProfileVersionDraftBodySchema.safeParse({
        associatedResourceEventRoutingConfig: {
          enabled: true,
          resources: [
            {
              resourceKind: "github.pull_request",
              eventTypes: ["github.pull_request.issue_comment.created"],
              payloadFilter: {
                "github.pull_request.review.submitted": {
                  op: "eq",
                  path: ["review", "state"],
                  value: "approved",
                },
              },
            },
          ],
        },
      }).success,
    ).toBe(false);
  });
});
