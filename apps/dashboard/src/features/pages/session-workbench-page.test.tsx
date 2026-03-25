// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it } from "vitest";

import { AppShellHeaderActionsContext } from "../shell/app-shell-header-actions.js";
import { SessionWorkbenchPage } from "./session-workbench-page.js";

describe("SessionWorkbenchPage", () => {
  it("renders the dedicated session shell for a sandbox instance route", () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          gcTime: Infinity,
          refetchOnMount: false,
          retry: false,
          staleTime: Infinity,
        },
      },
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
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          gcTime: Infinity,
          refetchOnMount: false,
          retry: false,
          staleTime: Infinity,
        },
      },
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

  it("starts the automatic resume flow for a stopped sandbox", () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          gcTime: Infinity,
          refetchOnMount: false,
          retry: false,
          staleTime: Infinity,
        },
      },
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

    expect(screen.queryByText("Stopped sandbox")).toBeNull();
  });
});
