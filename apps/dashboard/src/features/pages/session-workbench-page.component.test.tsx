// @vitest-environment jsdom

import { SidebarProvider } from "@mistle/ui";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, type RenderResult, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeAll, describe, expect, it } from "vitest";

import { createTestQueryClient } from "../../test-support/query-client.js";
import { sandboxInstanceStatusQueryKey } from "../sessions/sessions-query-keys.js";
import { SessionWorkbenchPage } from "./session-workbench-page.js";

function renderSessionWorkbenchPage(input?: {
  queryClientOptions?: Parameters<typeof createTestQueryClient>[0];
  sandboxInstanceId?: string;
  sidebarDefaultOpen?: boolean;
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
      title: "Test session",
    });
  }

  return {
    queryClient,
    ...render(
      <SidebarProvider defaultOpen={input?.sidebarDefaultOpen ?? true}>
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={[`/sessions/${sandboxInstanceId}`]}>
            <Routes>
              <Route element={<SessionWorkbenchPage />} path="/sessions/:sandboxInstanceId" />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>
      </SidebarProvider>,
    ),
  };
}

function installMatchMedia(): void {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

describe("SessionWorkbenchPage", () => {
  beforeAll(() => {
    installMatchMedia();

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

  it("renders the processes header action in the session workspace header", async () => {
    renderSessionWorkbenchPage({
      seededStatus: "running",
    });
    const workspaceHeader = screen.getByRole("banner");

    expect(
      await within(workspaceHeader).findByRole("button", {
        name: "Open processes",
      }),
    ).toBeTruthy();
  });

  it("renders the sidebar trigger in the session workspace header when the sidebar is collapsed", () => {
    renderSessionWorkbenchPage({
      seededStatus: "running",
      sidebarDefaultOpen: false,
    });
    const workspaceHeader = screen.getByRole("banner");

    expect(
      within(workspaceHeader).getByRole("button", {
        name: "Toggle Sidebar",
      }),
    ).toBeTruthy();
  });

  it("shows a running status indicator in the session workspace header", async () => {
    const sandboxInstanceId = "sbi_test";
    const view = renderSessionWorkbenchPage({
      sandboxInstanceId,
      seededStatus: "running",
    });

    await act(async () => {
      view.queryClient.setQueryData(sandboxInstanceStatusQueryKey(sandboxInstanceId), {
        automationConversation: null,
        connectable: false,
        failureCode: null,
        failureMessage: null,
        id: sandboxInstanceId,
        runtimeContext: null,
        status: "running" as const,
        title: "Test session",
      });
    });

    const workspaceHeader = screen.getByRole("banner");

    const status = await within(workspaceHeader).findByRole("status", {
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
        title: "Test session",
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
        title: "Test session",
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
        title: "Test session",
      });
    });

    expect(await screen.findByRole("status", { name: "Connecting chat" })).toBeTruthy();
    expect(screen.queryByPlaceholderText("Ask anything")).toBeNull();
  });
});
