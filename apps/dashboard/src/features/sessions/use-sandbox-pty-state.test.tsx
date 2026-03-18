// @vitest-environment jsdom

import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useSandboxPtyState } from "./use-sandbox-pty-state.js";

describe("useSandboxPtyState", () => {
  it("starts idle with no PTY output or connection", () => {
    const { result } = renderHook(() => useSandboxPtyState());

    expect(result.current.lifecycle.state).toBe("idle");
    expect(result.current.lifecycle.connectedSandboxInstanceId).toBeNull();
    expect(result.current.lifecycle.errorMessage).toBeNull();
    expect(result.current.lifecycle.exitInfo).toBeNull();
    expect(result.current.lifecycle.resetInfo).toBeNull();
    expect(result.current.output.chunks).toEqual([]);
  });

  it("fails fast when opening a PTY without a sandbox instance id", async () => {
    const { result } = renderHook(() => useSandboxPtyState());

    await expect(
      result.current.actions.openPty({
        sandboxInstanceId: "   ",
        cols: 80,
        rows: 24,
      }),
    ).rejects.toThrow("Sandbox instance id is required to open a PTY session.");

    expect(result.current.lifecycle.state).toBe("idle");
    expect(result.current.lifecycle.connectedSandboxInstanceId).toBeNull();
    expect(result.current.output.chunks).toEqual([]);
  });
});
