// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useCodexSessionPageController } from "./use-codex-session-page-controller.js";
import { DEFAULT_TERMINAL_PANEL_SIZE } from "./use-session-terminal-workbench-state.js";

describe("useCodexSessionPageController", () => {
  it("returns separate workbench and Codex pane state for a missing session id", () => {
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
        useCodexSessionPageController({
          sandboxInstanceId: null,
        }),
      {
        wrapper,
      },
    );

    expect(Object.keys(result.current)).toEqual(["workbench", "codexPane"]);
    expect(result.current.workbench.hasTopAlert).toBe(false);
    expect(result.current.workbench.ptyState.lifecycle.connectedSandboxInstanceId).toBeNull();
    expect(result.current.workbench.ptyState.lifecycle.state).toBe("closed");
    expect(result.current.workbench.ptyState.output.chunks).toEqual([]);
    expect(result.current.workbench.terminalPanelState.isVisible).toBe(false);
    expect(result.current.workbench.terminalPanelState.panelSize).toBe(DEFAULT_TERMINAL_PANEL_SIZE);
    expect(result.current.workbench.startErrorMessage).toBeNull();
    expect(result.current.workbench.sandboxFailureMessage).toBeNull();
    expect(result.current.workbench.moreActionsState.connectedSession).toBeNull();
    expect(result.current.codexPane.chatState.entries).toEqual([]);
    expect(result.current.codexPane.composerProps.isConnected).toBe(false);
    expect(result.current.codexPane.composerProps.modelOptions).toEqual([]);
    expect(result.current.codexPane.serverRequestsState.pendingServerRequests).toEqual([]);
  });

  it("persists terminal panel visibility and size per sandbox instance", () => {
    window.localStorage.clear();

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
        useCodexSessionPageController({
          sandboxInstanceId,
        }),
      {
        initialProps: {
          sandboxInstanceId: "sbi-one",
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
      sandboxInstanceId: "sbi-two",
    });

    expect(result.current.workbench.terminalPanelState.isVisible).toBe(false);
    expect(result.current.workbench.terminalPanelState.panelSize).toBe(DEFAULT_TERMINAL_PANEL_SIZE);

    rerender({
      sandboxInstanceId: "sbi-one",
    });

    expect(result.current.workbench.terminalPanelState.isVisible).toBe(true);
    expect(result.current.workbench.terminalPanelState.panelSize).toBe(52);
  });
});
