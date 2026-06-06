import { describe, expect, it } from "vitest";

import { updateSandboxdGoVersion } from "./sandboxd-version.js";

describe("updateSandboxdGoVersion", () => {
  it("updates the sandboxd Go version constant", () => {
    const source = `const (
\tVersion                  = "0.9.0"
\tDefaultControlSocketPath = "/run/mistle/sandboxd.sock"
)`;

    expect(updateSandboxdGoVersion(source, "0.10.0")).toBe(`const (
\tVersion                  = "0.10.0"
\tDefaultControlSocketPath = "/run/mistle/sandboxd.sock"
)`);
  });

  it("fails when the sandboxd version const is missing", () => {
    expect(() => updateSandboxdGoVersion('const Other = "0.9.0"', "0.10.0")).toThrow(
      "packages/sandboxd/internal/sandboxd/sandboxd.go is missing the Version const",
    );
  });
});
