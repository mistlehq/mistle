// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it } from "vitest";

import { AppShellHeaderActionsContext } from "../shell/app-shell-header-actions.js";
import { CodexSessionPage } from "./codex-session-page.js";

describe("CodexSessionPage", () => {
  it("renders the dedicated session shell for a sandbox instance route", () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });

    render(
      <AppShellHeaderActionsContext.Provider value={() => {}}>
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={["/sessions/sbi_test"]}>
            <Routes>
              <Route element={<CodexSessionPage />} path="/sessions/:sandboxInstanceId" />
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
          retry: false,
        },
      },
    });

    const { container } = render(
      <AppShellHeaderActionsContext.Provider value={() => {}}>
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={["/sessions/sbi_test"]}>
            <Routes>
              <Route element={<CodexSessionPage />} path="/sessions/:sandboxInstanceId" />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>
      </AppShellHeaderActionsContext.Provider>,
    );

    const pageRoot = container.firstElementChild;
    expect(pageRoot?.firstElementChild?.getAttribute("role")).toBe("region");
  });
});
