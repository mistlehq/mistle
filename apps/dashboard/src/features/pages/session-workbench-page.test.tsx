// @vitest-environment jsdom

import { QueryClientProvider } from "@tanstack/react-query";
import { type RenderResult, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it } from "vitest";

import { createTestQueryClient } from "../../test-support/query-client.js";
import { AppShellHeaderActionsContext } from "../shell/app-shell-header-actions.js";
import { SessionWorkbenchPage } from "./session-workbench-page.js";
import { getSandboxInstanceStatusQueryKey } from "./use-session-workbench-controller.js";

function renderSessionWorkbenchPage(input?: {
  queryClientOptions?: Parameters<typeof createTestQueryClient>[0];
  sandboxInstanceId?: string;
  seededStatus?: "starting" | "running" | "stopped" | "failed";
}): RenderResult {
  const sandboxInstanceId = input?.sandboxInstanceId ?? "sbi_test";
  const queryClient = createTestQueryClient({
    gcTime: Infinity,
    refetchOnMount: false,
    staleTime: Infinity,
    ...input?.queryClientOptions,
  });

  if (input?.seededStatus !== undefined) {
    queryClient.setQueryData(getSandboxInstanceStatusQueryKey(sandboxInstanceId), {
      failureCode: null,
      failureMessage: null,
      id: sandboxInstanceId,
      status: input.seededStatus,
    });
  }

  return render(
    <AppShellHeaderActionsContext.Provider value={() => {}}>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[`/sessions/${sandboxInstanceId}`]}>
          <Routes>
            <Route element={<SessionWorkbenchPage />} path="/sessions/:sandboxInstanceId" />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </AppShellHeaderActionsContext.Provider>,
  );
}

describe("SessionWorkbenchPage", () => {
  it("renders the dedicated session shell for a sandbox instance route", () => {
    renderSessionWorkbenchPage();

    expect(screen.getByPlaceholderText("Ask anything")).toBeDefined();
  });

  it("does not reserve alert space when there are no alerts", () => {
    const { container } = renderSessionWorkbenchPage();

    const pageRoot = container.firstElementChild;
    expect(pageRoot?.firstElementChild?.getAttribute("role")).toBe("region");
  });
});
