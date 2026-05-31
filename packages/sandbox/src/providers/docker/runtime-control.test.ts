import { describe, expect, it } from "vitest";

import {
  SandboxdResetTransparentEgressNftablesTimeoutMs,
  SandboxdStopDaemonTimeoutMs,
} from "./runtime-control.js";

describe("Docker sandbox runtime control timeouts", () => {
  it("uses bounded daemon-stop and nftables-reset timeouts during sandboxd refresh", () => {
    expect(SandboxdStopDaemonTimeoutMs).toBe(30_000);
    expect(SandboxdResetTransparentEgressNftablesTimeoutMs).toBe(10_000);
  });
});
