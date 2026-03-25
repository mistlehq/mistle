// @vitest-environment jsdom

import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it } from "vitest";

import { createTestQueryClient } from "../../test-support/query-client.js";
import { AppShellHeaderActionsContext } from "../shell/app-shell-header-actions.js";
import { SessionWorkbenchPage } from "./session-workbench-page.js";

describe("SessionWorkbenchPage", () => {
  it("renders the dedicated session shell for a sandbox instance route", () => {
    const queryClient = createTestQueryClient({
      gcTime: Infinity,
      refetchOnMount: false,
      staleTime: Infinity,
    });

    render(
      <AppShellHeaderActionsContext.Provider value={() => {}}>
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={["/sessions/sbi_test"]}>
            <Routes>
              <Route element={<SessionWorkbenchPage />} path="/sessions/:sandboxInstanceId" />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>
      </AppShellHeaderActionsContext.Provider>,
    );

    expect(screen.getByPlaceholderText("Ask anything")).toBeDefined();
  });

  it("does not reserve alert space when there are no alerts", () => {
    const queryClient = createTestQueryClient({
      gcTime: Infinity,
      refetchOnMount: false,
      staleTime: Infinity,
    });

    const { container } = render(
      <AppShellHeaderActionsContext.Provider value={() => {}}>
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={["/sessions/sbi_test"]}>
            <Routes>
              <Route element={<SessionWorkbenchPage />} path="/sessions/:sandboxInstanceId" />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>
      </AppShellHeaderActionsContext.Provider>,
    );

    const pageRoot = container.firstElementChild;
    expect(pageRoot?.firstElementChild?.getAttribute("role")).toBe("region");
  });

  it("shows the stopped sandbox alert when resume is not implemented", () => {
    const queryClient = createTestQueryClient({
      gcTime: Infinity,
      refetchOnMount: false,
      staleTime: Infinity,
    });

    queryClient.setQueryData(["sandbox-instance-status", "sbi_stopped"], {
      failureCode: null,
      failureMessage: null,
      id: "sbi_stopped",
      status: "stopped",
    });

    render(
      <AppShellHeaderActionsContext.Provider value={() => {}}>
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={["/sessions/sbi_stopped"]}>
            <Routes>
              <Route element={<SessionWorkbenchPage />} path="/sessions/:sandboxInstanceId" />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>
      </AppShellHeaderActionsContext.Provider>,
    );

    expect(screen.getByText("Stopped sandbox")).toBeDefined();
    expect(
      screen.getByText(
        "This sandbox is stopped. Dashboard resume handling is not implemented yet, so chat and terminal stay disconnected until the sandbox is running.",
      ),
    ).toBeDefined();
  });
});
