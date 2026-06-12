import { describe, expect, it } from "vitest";

import { mapProfileVersionAssociatedResourceEventRoutingConfig } from "./profile-version-associated-resource-routing-config.js";

describe("mapProfileVersionAssociatedResourceEventRoutingConfig", () => {
  it("preserves associated resource payload filters in profile version responses", () => {
    expect(
      mapProfileVersionAssociatedResourceEventRoutingConfig({
        enabled: true,
        resources: [
          {
            resourceKind: "github.pull_request",
            eventTypes: ["github.pull_request.issue_comment.created"],
            payloadFilter: {
              "github.pull_request.issue_comment.created": {
                op: "and",
                filters: [
                  {
                    op: "contains_token",
                    path: ["comment", "body"],
                    value: "@mistle",
                  },
                  {
                    op: "eq",
                    path: ["repository", "full_name"],
                    value: "mistlehq/platform",
                  },
                ],
              },
            },
          },
        ],
      }),
    ).toEqual({
      enabled: true,
      resources: [
        {
          resourceKind: "github.pull_request",
          eventTypes: ["github.pull_request.issue_comment.created"],
          payloadFilter: {
            "github.pull_request.issue_comment.created": {
              op: "and",
              filters: [
                {
                  op: "contains_token",
                  path: ["comment", "body"],
                  value: "@mistle",
                },
                {
                  op: "eq",
                  path: ["repository", "full_name"],
                  value: "mistlehq/platform",
                },
              ],
            },
          },
        },
      ],
    });
  });
});
