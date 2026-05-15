import { describe, expect, it } from "vitest";

import { sandboxdCargoLockUpdateArgs, updateSandboxdCargoTomlVersion } from "./sandboxd-version.js";

describe("updateSandboxdCargoTomlVersion", () => {
  it("updates the sandboxd package version without touching dependency versions", () => {
    const cargoTomlContent = `[package]
name = "sandboxd"
version = "0.9.0"
edition = "2024"

[dependencies]
portable-pty = "0.9.0"
`;

    expect(updateSandboxdCargoTomlVersion(cargoTomlContent, "0.10.0")).toBe(`[package]
name = "sandboxd"
version = "0.10.0"
edition = "2024"

[dependencies]
portable-pty = "0.9.0"
`);
  });

  it("fails when the sandboxd package version is missing", () => {
    const cargoTomlContent = `[package]
name = "sandboxd"

[dependencies]
portable-pty = "0.9.0"
`;

    expect(() => updateSandboxdCargoTomlVersion(cargoTomlContent, "0.10.0")).toThrow(
      "packages/sandboxd/Cargo.toml [package].version must be a string.",
    );
  });
});

describe("sandboxdCargoLockUpdateArgs", () => {
  it("scopes the lockfile refresh to the sandboxd package version", () => {
    expect(sandboxdCargoLockUpdateArgs("/repo", "0.10.0")).toEqual([
      "update",
      "--manifest-path",
      "/repo/packages/sandboxd/Cargo.toml",
      "--package",
      "sandboxd",
      "--precise",
      "0.10.0",
    ]);
  });
});
