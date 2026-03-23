// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DEFAULT_TERMINAL_PANEL_SIZE } from "./use-session-terminal-workbench-state.js";
import {
  hasAutomationSessionPreparationTimedOut,
  resolveAutomationSessionPreparationTimeoutDelayMs,
  shouldWaitForAutomationSessionThread,
  useSessionWorkbenchController,
} from "./use-session-workbench-controller.js";

describe("useSessionWorkbenchController", () => {
  it("returns separate workbench and conversation pane state for a missing session id", () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });

    const wrapper = ({ children }: React.PropsWithChildren): React.JSX.Element => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const { result } = renderHook(
      () =>
        useSessionWorkbenchController({
          sandboxInstanceId: null,
        }),
      {
        wrapper,
      },
    );

    expect(Object.keys(result.current)).toEqual(["workbench", "conversationPane"]);
    expect(result.current.workbench.connectionReadiness).toEqual({
      canConnect: false,
      reason: "missing-session",
    });
    expect(result.current.workbench.stoppedSessionState).toEqual({
      message: null,
      requiresManualResume: false,
    });
    expect(result.current.workbench.hasTopAlert).toBe(false);
    expect(result.current.workbench.ptyState.lifecycle.connectedSandboxInstanceId).toBeNull();
    expect(result.current.workbench.ptyState.lifecycle.state).toBe("closed");
    expect(result.current.workbench.ptyState.output.chunks).toEqual([]);
    expect(result.current.workbench.terminalPanelState.isVisible).toBe(false);
    expect(result.current.workbench.terminalPanelState.panelSize).toBe(DEFAULT_TERMINAL_PANEL_SIZE);
    expect(result.current.workbench.startErrorMessage).toBeNull();
    expect(result.current.workbench.sandboxFailureMessage).toBeNull();
    expect(result.current.workbench.moreActionsState.connectedSession).toBeNull();
    expect(result.current.conversationPane.chatState.entries).toEqual([]);
    expect(result.current.conversationPane.composerProps.isConnected).toBe(false);
    expect(result.current.conversationPane.composerProps.modelOptions).toEqual([]);
    expect(result.current.conversationPane.serverRequestsState.pendingServerRequests).toEqual([]);
  });

  it("persists terminal panel visibility and size per sandbox instance", () => {
    const hasStorageApi =
      typeof window.localStorage === "object" &&
      window.localStorage !== null &&
      typeof window.localStorage.getItem === "function" &&
      typeof window.localStorage.removeItem === "function";
    const sandboxInstanceIdOne = `sbi-one-${Date.now()}`;
    const sandboxInstanceIdTwo = `sbi-two-${Date.now()}`;

    if (hasStorageApi) {
      window.localStorage.removeItem(
        `dashboard:session-terminal-workbench:${sandboxInstanceIdOne}`,
      );
      window.localStorage.removeItem(
        `dashboard:session-terminal-workbench:${sandboxInstanceIdTwo}`,
      );
    }

    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });

    const wrapper = ({ children }: React.PropsWithChildren): React.JSX.Element => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const { result, rerender } = renderHook(
      ({ sandboxInstanceId }: { sandboxInstanceId: string | null }) =>
        useSessionWorkbenchController({
          sandboxInstanceId,
        }),
      {
        initialProps: {
          sandboxInstanceId: sandboxInstanceIdOne,
        },
        wrapper,
      },
    );

    act(() => {
      result.current.workbench.terminalPanelState.openPanel();
      result.current.workbench.terminalPanelState.setPanelSize(52);
    });

    expect(result.current.workbench.terminalPanelState.isVisible).toBe(true);
    expect(result.current.workbench.terminalPanelState.panelSize).toBe(52);

    rerender({
      sandboxInstanceId: sandboxInstanceIdTwo,
    });

    expect(result.current.workbench.terminalPanelState.isVisible).toBe(false);
    expect(result.current.workbench.terminalPanelState.panelSize).toBe(DEFAULT_TERMINAL_PANEL_SIZE);

    rerender({
      sandboxInstanceId: sandboxInstanceIdOne,
    });

    const expectedVisibility = hasStorageApi;
    const expectedPanelSize = hasStorageApi ? 52 : DEFAULT_TERMINAL_PANEL_SIZE;

    expect(result.current.workbench.terminalPanelState.isVisible).toBe(expectedVisibility);
    expect(result.current.workbench.terminalPanelState.panelSize).toBe(expectedPanelSize);
  });

  it("waits for automation-backed sessions whose persisted thread id is still pending", () => {
    expect(
      shouldWaitForAutomationSessionThread({
        sandboxStatus: "running",
        automationConversation: {
          conversationId: "cnv_pending",
          routeId: "cvr_pending",
          providerConversationId: null,
        },
      }),
    ).toBe(true);

    expect(
      shouldWaitForAutomationSessionThread({
        sandboxStatus: "running",
        automationConversation: {
          conversationId: "cnv_ready",
          routeId: "cvr_ready",
          providerConversationId: "thread_ready",
        },
      }),
    ).toBe(false);

    expect(
      shouldWaitForAutomationSessionThread({
        sandboxStatus: "running",
        automationConversation: null,
      }),
    ).toBe(false);
  });

  it("times out automation pending state after the configured wait window", () => {
    expect(
      hasAutomationSessionPreparationTimedOut({
        pendingSinceMs: null,
        nowMs: 30_000,
      }),
    ).toBe(false);

    expect(
      hasAutomationSessionPreparationTimedOut({
        pendingSinceMs: 0,
        nowMs: 29_999,
      }),
    ).toBe(false);

    expect(
      hasAutomationSessionPreparationTimedOut({
        pendingSinceMs: 0,
        nowMs: 30_000,
      }),
    ).toBe(true);
  });

  it("computes the remaining automation preparation timeout delay", () => {
    expect(
      resolveAutomationSessionPreparationTimeoutDelayMs({
        pendingSinceMs: null,
        nowMs: 30_000,
      }),
    ).toBeNull();

    expect(
      resolveAutomationSessionPreparationTimeoutDelayMs({
        pendingSinceMs: 0,
        nowMs: 0,
      }),
    ).toBe(30_000);

    expect(
      resolveAutomationSessionPreparationTimeoutDelayMs({
        pendingSinceMs: 0,
        nowMs: 29_999,
      }),
    ).toBe(1);

    expect(
      resolveAutomationSessionPreparationTimeoutDelayMs({
        pendingSinceMs: 0,
        nowMs: 30_000,
      }),
    ).toBe(0);
  });
});
