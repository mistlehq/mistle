import { describe, expect, it } from "vitest";

import {
  createManifestJsonDraft,
  formatManifestJson,
  validateManifestJsonObject,
} from "./manifest-json-editor.js";

describe("manifest JSON editor helpers", () => {
  it("formats valid manifest JSON", () => {
    expect(formatManifestJson('{"name":"Mistle","default_events":["issues"]}')).toBe(
      '{\n  "name": "Mistle",\n  "default_events": [\n    "issues"\n  ]\n}',
    );
  });

  it("creates formatted manifest JSON drafts", () => {
    expect(
      createManifestJsonDraft({
        name: "Mistle",
        default_events: ["issues"],
      }),
    ).toBe('{\n  "name": "Mistle",\n  "default_events": [\n    "issues"\n  ]\n}');
  });

  it("validates manifest JSON syntax", () => {
    expect(validateManifestJsonObject('{"name":"Mistle"}')).toEqual({ status: "valid" });

    const invalidResult = validateManifestJsonObject('{"name":');
    expect(invalidResult.status).toBe("invalid");
    if (invalidResult.status !== "invalid") {
      throw new Error("invalid manifest JSON must return an invalid validation result");
    }
    expect(invalidResult.message.length).toBeGreaterThan(0);

    expect(validateManifestJsonObject("[]")).toEqual({
      message: "Manifest must be a JSON object.",
      status: "invalid",
    });
  });
});
