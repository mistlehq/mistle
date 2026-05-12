// @vitest-environment jsdom

import type { SandboxSessionTransport } from "@mistle/sandbox-session-client";
import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useOpenCodeSessionState } from "./use-opencode-session-state.js";

async function ensureTransportConnected(): Promise<{
  sandboxInstanceId: string;
  transport: SandboxSessionTransport;
}> {
  throw new Error("This test does not connect to a sandbox transport.");
}

describe("useOpenCodeSessionState", () => {
  it("keeps lifecycle callbacks stable across rerenders", () => {
    const { result, rerender } = renderHook(() =>
      useOpenCodeSessionState({
        ensureTransportConnected,
      }),
    );
    const clearLifecycleErrorMessage = result.current.lifecycle.clearLifecycleErrorMessage;
    const connectSession = result.current.lifecycle.connectSession;
    const disconnectSession = result.current.lifecycle.disconnectSession;
    const recoverSession = result.current.lifecycle.recoverSession;

    rerender();

    expect(result.current.lifecycle.clearLifecycleErrorMessage).toBe(clearLifecycleErrorMessage);
    expect(result.current.lifecycle.connectSession).toBe(connectSession);
    expect(result.current.lifecycle.disconnectSession).toBe(disconnectSession);
    expect(result.current.lifecycle.recoverSession).toBe(recoverSession);
  });
});
