import { describe, expect, it } from "vitest";

import { SandboxConfigurationError } from "./errors.js";
import {
  resolveSandboxdOperationLogPath,
  SandboxdOperationLogPaths,
} from "./operation-log-paths.js";

describe("resolveSandboxdOperationLogPath", () => {
  it("resolves supported sandboxd operation log paths", () => {
    expect(resolveSandboxdOperationLogPath("activate")).toBe(SandboxdOperationLogPaths.activate);
    expect(resolveSandboxdOperationLogPath("bootstrap_tunnel")).toBe(
      SandboxdOperationLogPaths.bootstrap_tunnel,
    );
  });

  it("rejects unsupported operation log names at runtime", () => {
    expect(() =>
      Reflect.apply(resolveSandboxdOperationLogPath, undefined, ["unsupported_operation"]),
    ).toThrow(SandboxConfigurationError);
  });
});
