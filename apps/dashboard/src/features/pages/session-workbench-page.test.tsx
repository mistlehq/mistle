// @vitest-environment jsdom

import { QueryClientProvider } from "@tanstack/react-query";
import { act, type RenderResult, render, screen } from "@testing-library/react";
import { useState } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it } from "vitest";

import { createTestQueryClient } from "../../test-support/query-client.js";
import { AppShellHeaderActionsContext } from "../shell/app-shell-header-actions.js";
import { SessionWorkbenchPage } from "./session-workbench-page.js";
import { getSandboxInstanceStatusQueryKey } from "./use-session-workbench-controller.js";

function HeaderActionsHarness(input: React.PropsWithChildren): React.JSX.Element {
  const [actions, setActions] = useState<React.ReactNode | null>(null);

  return (
    <AppShellHeaderActionsContext.Provider value={setActions}>
      {input.children}
      <div data-testid="header-actions-host">{actions}</div>
    </AppShellHeaderActionsContext.Provider>
  );
}

function renderSessionWorkbenchPage(input?: {
  queryClientOptions?: Parameters<typeof createTestQueryClient>[0];
  sandboxInstanceId?: string;
  seededStatus?: "starting" | "running" | "stopped" | "failed";
}): RenderResult & { queryClient: ReturnType<typeof createTestQueryClient> } {
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

  return {
    queryClient,
    ...render(
      <HeaderActionsHarness>
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={[`/sessions/${sandboxInstanceId}`]}>
            <Routes>
              <Route element={<SessionWorkbenchPage />} path="/sessions/:sandboxInstanceId" />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>
      </HeaderActionsHarness>,
    ),
  };
}

describe("SessionWorkbenchPage", () => {
  it("renders the dedicated session shell for a sandbox instance route", () => {
    renderSessionWorkbenchPage();

    expect(screen.getByPlaceholderText("Ask anything")).toBeDefined();
  });

  it("does not reserve alert space when there are no alerts", () => {
    renderSessionWorkbenchPage();

    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("registers the processes header action on the session workbench", async () => {
    renderSessionWorkbenchPage({
      seededStatus: "running",
    });

    expect(await screen.findByRole("button", { name: "Open processes" })).toBeTruthy();
  });

  it("shows a running header status indicator for running sessions", async () => {
    const sandboxInstanceId = "sbi_test";
    const view = renderSessionWorkbenchPage({
      sandboxInstanceId,
      seededStatus: "running",
    });

    await act(async () => {
      view.queryClient.setQueryData(getSandboxInstanceStatusQueryKey(sandboxInstanceId), {
        failureCode: null,
        failureMessage: null,
        id: sandboxInstanceId,
        status: "running" as const,
      });
    });

    const status = await screen.findByRole("status", { name: "Running" });
    expect(status.className).toContain("bg-emerald-600");
    expect(status.className).toContain("border-emerald-700");
  });
});
