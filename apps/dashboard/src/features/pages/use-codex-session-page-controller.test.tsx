// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useCodexSessionPageController } from "./use-codex-session-page-controller.js";

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
    expect(result.current.workbench.startErrorMessage).toBeNull();
    expect(result.current.workbench.sandboxFailureMessage).toBeNull();
    expect(result.current.workbench.moreActionsState.connectedSession).toBeNull();
    expect(result.current.codexPane.chatState.entries).toEqual([]);
    expect(result.current.codexPane.composerProps.isConnected).toBe(false);
    expect(result.current.codexPane.composerProps.modelOptions).toEqual([]);
    expect(result.current.codexPane.serverRequestsState.pendingServerRequests).toEqual([]);
  });
});
