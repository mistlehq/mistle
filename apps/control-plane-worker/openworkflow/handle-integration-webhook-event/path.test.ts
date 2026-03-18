import { describe, expect, it } from "vitest";

import { path } from "./path.js";

describe("webhook filter path", () => {
  it("parses dot-delimited paths", () => {
    expect(path("comment.body")).toEqual(["comment", "body"]);
  });

  it("returns a cloned path array", () => {
    const input = ["comment", "body"];
    const parsed = path(input);

    input[1] = "title";

    expect(parsed).toEqual(["comment", "body"]);
  });

  it("throws for invalid path inputs", () => {
    expect(() => path("")).toThrow("Webhook payload filter path must not be empty.");
    expect(() => path("comment..body")).toThrow(
      "Webhook payload filter path must not contain empty segments.",
    );
    expect(() => path([])).toThrow(
      "Webhook payload filter path must contain at least one segment.",
    );
    expect(() => path(["comment", ""])).toThrow(
      "Webhook payload filter path must not contain empty segments.",
    );
  });
});
