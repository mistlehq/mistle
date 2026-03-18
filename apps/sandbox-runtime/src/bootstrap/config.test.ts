import { describe, expect, it } from "vitest";

import { DefaultSandboxUser, SandboxUserEnv, loadBootstrapConfig } from "./config.js";

describe("loadBootstrapConfig", () => {
  it("uses the default sandbox user when the env is absent", () => {
    const config = loadBootstrapConfig(() => undefined);

    expect(config.sandboxUser).toBe(DefaultSandboxUser);
  });

  it("rejects an empty sandbox user override", () => {
    expect(() =>
      loadBootstrapConfig((key) => {
        if (key === SandboxUserEnv) {
          return "   ";
        }

        return undefined;
      }),
    ).toThrow(`${SandboxUserEnv} must not be empty when set`);
  });

  it("rejects a non-default sandbox user override", () => {
    expect(() =>
      loadBootstrapConfig((key) => {
        if (key === SandboxUserEnv) {
          return "root";
        }

        return undefined;
      }),
    ).toThrow(`${SandboxUserEnv} is reserved and must be "${DefaultSandboxUser}"`);
  });
});
