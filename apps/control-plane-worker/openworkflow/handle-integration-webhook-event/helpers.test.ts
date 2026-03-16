import { describe, expect, it } from "vitest";

import {
  and,
  contains,
  endsWith,
  eq,
  exists,
  inList,
  neq,
  not,
  notExists,
  or,
  startsWith,
} from "./helpers.js";
import { path } from "./path.js";

describe("webhook filter helpers", () => {
  it("builds filters with helper functions", () => {
    const filter = and([
      eq(path("action"), "created"),
      contains(path("comment.body"), "@mistlebot"),
      neq(path(["sender", "login"]), "dependabot[bot]"),
      inList(path("action"), ["created", "edited"]),
      startsWith(path("comment.body"), "hello"),
      endsWith(path("comment.body"), "mistlebot"),
      exists(path("comment.body")),
      not(notExists(path("comment.body"))),
      or([eq(path("repository.private"), false), eq(path("repository.private"), true)]),
    ]);

    expect(filter).toEqual({
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
        {
          op: "neq",
          path: ["sender", "login"],
          value: "dependabot[bot]",
        },
        {
          op: "in",
          path: ["action"],
          values: ["created", "edited"],
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
        {
          op: "exists",
          path: ["comment", "body"],
        },
        {
          op: "not",
          filter: {
            op: "not_exists",
            path: ["comment", "body"],
          },
        },
        {
          op: "or",
          filters: [
            {
              op: "eq",
              path: ["repository", "private"],
              value: false,
            },
            {
              op: "eq",
              path: ["repository", "private"],
              value: true,
            },
          ],
        },
      ],
    });
  });

  it("throws for invalid helper inputs", () => {
    expect(() => and([])).toThrowError(
      "Webhook payload filter composition requires at least one filter.",
    );
    expect(() => or([])).toThrowError(
      "Webhook payload filter composition requires at least one filter.",
    );
    expect(() => inList(path("action"), [])).toThrowError(
      "Webhook payload filter in-list requires at least one value.",
    );
  });

  it("clones helper inputs to avoid mutation side effects", () => {
    const mutablePath = ["comment", "body"];
    const mutableValues = ["created", "edited"];
    const mutableFilters = [eq(mutablePath, "created")];

    const eqFilter = eq(mutablePath, "created");
    const inFilter = inList(path("action"), mutableValues);
    const andFilter = and(mutableFilters);

    mutablePath[1] = "title";
    mutableValues[0] = "deleted";
    mutableFilters.push(eq(path("action"), "edited"));

    expect(eqFilter.path).toEqual(["comment", "body"]);
    expect(inFilter.values).toEqual(["created", "edited"]);
    expect(andFilter.filters).toHaveLength(1);
  });
});
