// @vitest-environment jsdom

import { QueryClientProvider } from "@tanstack/react-query";
import { act, type RenderResult, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeAll, describe, expect, it } from "vitest";

import { createTestQueryClient } from "../../test-support/query-client.js";
import { sandboxInstanceStatusQueryKey } from "../sessions/sessions-query-keys.js";
import { AppShellHeaderActionsContext } from "../shell/app-shell-header-actions.js";
import { SessionWorkbenchPage } from "./session-workbench-page.js";

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
  seededStatus?: "pending" | "starting" | "running" | "stopped" | "failed";
}): RenderResult & { queryClient: ReturnType<typeof createTestQueryClient> } {
  const sandboxInstanceId = input?.sandboxInstanceId ?? "sbi_test";
  const queryClient = createTestQueryClient({
    gcTime: Infinity,
    refetchOnMount: false,
    staleTime: Infinity,
    ...input?.queryClientOptions,
  });

  if (input?.seededStatus !== undefined) {
    queryClient.setQueryData(sandboxInstanceStatusQueryKey(sandboxInstanceId), {
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
  beforeAll(() => {
    Object.defineProperty(globalThis, "ResizeObserver", {
      configurable: true,
      value: class ResizeObserver {
        disconnect(): void {}
        observe(): void {}
        unobserve(): void {}
      },
      writable: true,
    });
  });

  it("shows the initial loading startup state before sandbox status is trusted", () => {
    renderSessionWorkbenchPage();

    expect(screen.getByRole("status", { name: "Loading sandbox status" })).toBeTruthy();
    expect(screen.queryByPlaceholderText("Ask anything")).toBeNull();
  });

  it("does not reserve alert space when there are no alerts", () => {
    renderSessionWorkbenchPage();

    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("registers the processes header action on the session workbench", async () => {
    const view = renderSessionWorkbenchPage({
      seededStatus: "running",
    });
    const headerActionsHost = view.container.querySelector('[data-testid="header-actions-host"]');

    expect(headerActionsHost).not.toBeNull();

    expect(
      await within(headerActionsHost as HTMLElement).findByRole("button", {
        name: "Open processes",
      }),
    ).toBeTruthy();
  });

  it("shows a running header status indicator for running sessions", async () => {
    const sandboxInstanceId = "sbi_test";
    const view = renderSessionWorkbenchPage({
      sandboxInstanceId,
      seededStatus: "running",
    });

    await act(async () => {
      view.queryClient.setQueryData(sandboxInstanceStatusQueryKey(sandboxInstanceId), {
        failureCode: null,
        failureMessage: null,
        id: sandboxInstanceId,
        status: "running" as const,
      });
    });
    const headerActionsHost = view.container.querySelector('[data-testid="header-actions-host"]');

    expect(headerActionsHost).not.toBeNull();

    const status = await within(headerActionsHost as HTMLElement).findByRole("status", {
      name: "Running",
    });
    expect(status.className).toContain("bg-emerald-600");
    expect(status.className).toContain("border-emerald-700");
  });

  it("shows preparing sandbox while the trusted sandbox status is pending", async () => {
    const sandboxInstanceId = "sbi_test";
    const view = renderSessionWorkbenchPage({
      sandboxInstanceId,
      seededStatus: "pending",
    });

    await act(async () => {
      view.queryClient.setQueryData(sandboxInstanceStatusQueryKey(sandboxInstanceId), {
        failureCode: null,
        failureMessage: null,
        id: sandboxInstanceId,
        status: "pending" as const,
      });
    });

    expect(await screen.findByRole("status", { name: "Preparing sandbox" })).toBeTruthy();
    expect(screen.queryByPlaceholderText("Ask anything")).toBeNull();
  });

  it("shows running setup while the trusted sandbox status is starting", async () => {
    const sandboxInstanceId = "sbi_test";
    const view = renderSessionWorkbenchPage({
      sandboxInstanceId,
      seededStatus: "starting",
    });

    await act(async () => {
      view.queryClient.setQueryData(sandboxInstanceStatusQueryKey(sandboxInstanceId), {
        failureCode: null,
        failureMessage: null,
        id: sandboxInstanceId,
        status: "starting" as const,
      });
    });

    expect(await screen.findByRole("status", { name: "Running setup" })).toBeTruthy();
    expect(screen.queryByPlaceholderText("Ask anything")).toBeNull();
  });

  it("shows connecting chat while the sandbox is running but chat is not connected yet", async () => {
    const sandboxInstanceId = "sbi_test";
    const view = renderSessionWorkbenchPage({
      sandboxInstanceId,
      seededStatus: "running",
    });

    await act(async () => {
      view.queryClient.setQueryData(sandboxInstanceStatusQueryKey(sandboxInstanceId), {
        failureCode: null,
        failureMessage: null,
        id: sandboxInstanceId,
        status: "running" as const,
      });
    });

    expect(await screen.findByRole("status", { name: "Connecting chat" })).toBeTruthy();
    expect(screen.queryByPlaceholderText("Ask anything")).toBeNull();
  });
});
