import { describe, expect, it } from "vitest";

import { sandboxTelemetryErrorCode } from "./telemetry.js";

class ErrorWithCode extends Error {
  readonly code: string;

  constructor(code: string) {
    super("coded error");
    this.name = "ErrorWithCode";
    this.code = code;
  }
}

describe("sandboxTelemetryErrorCode", () => {
  it("uses explicit error codes when provider errors expose one", () => {
    expect(sandboxTelemetryErrorCode(new ErrorWithCode("not_found"))).toBe("not_found");
  });

  it("falls back to the error name when no explicit code is available", () => {
    const error = new Error("network failed");
    error.name = "NetworkError";

    expect(sandboxTelemetryErrorCode(error)).toBe("NetworkError");
  });

  it("uses the value type for non-error throws", () => {
    expect(sandboxTelemetryErrorCode("badness")).toBe("string");
  });
});
