import { describe, expect, it } from "vitest";

import { SandboxConfigurationError } from "./errors.js";
import {
  SandboxRuntimeEnv,
  SandboxRuntimeEnvDefaults,
  withRequiredSandboxRuntimeEnv,
} from "./runtime-env.js";

describe("withRequiredSandboxRuntimeEnv", () => {
  it("injects required runtime env values", () => {
    expect(withRequiredSandboxRuntimeEnv(undefined)).toEqual({
      [SandboxRuntimeEnv.LISTEN_ADDR]: SandboxRuntimeEnvDefaults.LISTEN_ADDR,
      [SandboxRuntimeEnv.USER]: SandboxRuntimeEnvDefaults.USER,
    });
  });

  it("preserves caller env alongside required runtime env values", () => {
    expect(
      withRequiredSandboxRuntimeEnv({
        MISTLE_CUSTOM_ENV: "present",
      }),
    ).toEqual({
      MISTLE_CUSTOM_ENV: "present",
      [SandboxRuntimeEnv.LISTEN_ADDR]: SandboxRuntimeEnvDefaults.LISTEN_ADDR,
      [SandboxRuntimeEnv.USER]: SandboxRuntimeEnvDefaults.USER,
    });
  });

  it("rejects conflicting reserved listen address values", () => {
    expect(() =>
      withRequiredSandboxRuntimeEnv({
        [SandboxRuntimeEnv.LISTEN_ADDR]: "127.0.0.1:9000",
      }),
    ).toThrow(SandboxConfigurationError);
  });

  it("rejects conflicting reserved sandbox user values", () => {
    expect(() =>
      withRequiredSandboxRuntimeEnv({
        [SandboxRuntimeEnv.USER]: "root",
      }),
    ).toThrow(SandboxConfigurationError);
  });
});
