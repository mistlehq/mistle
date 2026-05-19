import { describe, expect, it } from "vitest";

import { mstlCliCargoLockUpdateArgs, mstlCoreCargoLockUpdateArgs } from "./mstl-version.js";

describe("mstlCoreCargoLockUpdateArgs", () => {
  it("scopes the mstl-core lockfile refresh to the mstl-core package version", () => {
    expect(mstlCoreCargoLockUpdateArgs("/repo", "0.17.0")).toEqual([
      "update",
      "--manifest-path",
      "/repo/packages/mstl-core/Cargo.toml",
      "--package",
      "mstl-core",
      "--precise",
      "0.17.0",
    ]);
  });
});

describe("mstlCliCargoLockUpdateArgs", () => {
  it("scopes the mstl-cli lockfile refresh to the selected package version", () => {
    expect(mstlCliCargoLockUpdateArgs("/repo", "mstl-cli", "0.17.0")).toEqual([
      "update",
      "--manifest-path",
      "/repo/packages/mstl-cli/Cargo.toml",
      "--package",
      "mstl-cli",
      "--precise",
      "0.17.0",
    ]);
  });
});
