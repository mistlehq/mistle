// @vitest-environment jsdom

import type { SandboxInstanceStatus } from "@mistle/sandbox-lifecycle";
import { SidebarProvider } from "@mistle/ui";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, type RenderResult, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeAll, describe, expect, it } from "vitest";

import { createTestQueryClient } from "../../test-support/query-client.js";
import { HttpApiError } from "../api/http-api-error.js";
import { sandboxInstanceStatusQueryKey } from "../sessions/sessions-query-keys.js";
import type { SandboxInstanceStatusResult } from "../sessions/sessions-service.js";
import { SessionWorkbenchPage } from "./session-workbench-page.js";

function renderSessionWorkbenchPage(input?: {
  queryClientOptions?: Parameters<typeof createTestQueryClient>[0];
  sandboxInstanceId?: string;
  sidebarDefaultOpen?: boolean;
  seededStatus?: SandboxInstanceStatus;
}): RenderResult & { queryClient: ReturnType<typeof createTestQueryClient> } {
  const sandboxInstanceId = input?.sandboxInstanceId ?? "sbi_test";
  const queryClient = createTestQueryClient({
    gcTime: Infinity,
    refetchOnMount: false,
    retryOnMount: false,
    staleTime: Infinity,
    ...input?.queryClientOptions,
  });

  if (input?.seededStatus !== undefined) {
    queryClient.setQueryData(sandboxInstanceStatusQueryKey(sandboxInstanceId), {
      failureCode: null,
      failureMessage: null,
      id: sandboxInstanceId,
      triggerConversation: null,
      connectable: false,
      runtimeContext: null,
      startupOperation: null,
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

async function setSandboxStatusError(input: {
  queryClient: ReturnType<typeof createTestQueryClient>;
  sandboxInstanceId: string;
  status: number;
  message: string;
}): Promise<void> {
  const error = new HttpApiError({
    operation: "getSandboxInstanceStatus",
    status: input.status,
    body: null,
    message: input.message,
  });
  const query = input.queryClient.getQueryCache().find({
    queryKey: sandboxInstanceStatusQueryKey(input.sandboxInstanceId),
  });

  if (query === undefined) {
    throw new Error("Expected sandbox status query to exist.");
  }

  await act(async () => {
    query.setState({
      ...query.state,
      error,
      fetchStatus: "idle",
      status: "error",
    });
  });
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

  it("shows unavailable resource state when sandbox status becomes a 404", async () => {
    const sandboxInstanceId = "sbi_test";
    const view = renderSessionWorkbenchPage({
      sandboxInstanceId,
      sidebarDefaultOpen: false,
      seededStatus: "running",
    });

    await setSandboxStatusError({
      queryClient: view.queryClient,
      sandboxInstanceId,
      status: 404,
      message: "Could not check sandbox session status.",
    });

    expect(await screen.findByRole("heading", { name: "Page not found" })).toBeTruthy();
    expect(
      screen.getByText("This page does not exist or you do not have access to it."),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Open processes" })).toBeNull();
    expect(screen.getByRole("button", { name: "Toggle Sidebar" })).toBeTruthy();
  });

  it("keeps the workbench error notice for non-404 sandbox status failures", async () => {
    const sandboxInstanceId = "sbi_test";
    const view = renderSessionWorkbenchPage({
      sandboxInstanceId,
      seededStatus: "running",
    });

    await setSandboxStatusError({
      queryClient: view.queryClient,
      sandboxInstanceId,
      status: 500,
      message: "Could not check sandbox session status.",
    });

    expect(await screen.findByText("Could not load sandbox status")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Page not found" })).toBeNull();
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
      const status = {
        triggerConversation: null,
        connectable: false,
        failureCode: null,
        failureMessage: null,
        id: sandboxInstanceId,
        sandboxProfileId: "sbp_test",
        sandboxProfileVersion: 1,
        runtimeContext: null,
        startupOperation: null,
        status: "running",
        title: "Test session",
      } satisfies SandboxInstanceStatusResult;

      view.queryClient.setQueryData(sandboxInstanceStatusQueryKey(sandboxInstanceId), status);
    });

    const workspaceHeader = screen.getByRole("banner");

    const status = await within(workspaceHeader).findByRole("status", {
      name: "Running",
    });
    expect(status.className).toContain("bg-emerald-600");
    expect(status.className).toContain("text-white");
  });

  it("shows an expanded lifecycle status indicator in the session workspace header", async () => {
    const sandboxInstanceId = "sbi_test";
    const view = renderSessionWorkbenchPage({
      sandboxInstanceId,
      seededStatus: "reconnecting",
    });

    await act(async () => {
      const status = {
        triggerConversation: null,
        connectable: false,
        failureCode: null,
        failureMessage: null,
        id: sandboxInstanceId,
        sandboxProfileId: "sbp_test",
        sandboxProfileVersion: 1,
        runtimeContext: null,
        startupOperation: null,
        status: "reconnecting",
        title: "Test session",
      } satisfies SandboxInstanceStatusResult;

      view.queryClient.setQueryData(sandboxInstanceStatusQueryKey(sandboxInstanceId), status);
    });

    const workspaceHeader = screen.getByRole("banner");

    const status = await within(workspaceHeader).findByRole("status", {
      name: "Reconnecting",
    });
    expect(status.className).toContain("border-amber-500/45");
    expect(status.className).toContain("text-amber-700");
  });

  it("shows preparing sandbox while the trusted sandbox status is pending", async () => {
    const sandboxInstanceId = "sbi_test";
    const view = renderSessionWorkbenchPage({
      sandboxInstanceId,
      seededStatus: "pending",
    });

    await act(async () => {
      const status = {
        failureCode: null,
        failureMessage: null,
        id: sandboxInstanceId,
        sandboxProfileId: "sbp_test",
        sandboxProfileVersion: 1,
        triggerConversation: null,
        connectable: false,
        runtimeContext: null,
        startupOperation: {
          operationId: "owfr_session_startup_test",
          operationKind: "start",
        },
        status: "pending",
        title: "Test session",
      } satisfies SandboxInstanceStatusResult;

      view.queryClient.setQueryData(sandboxInstanceStatusQueryKey(sandboxInstanceId), status);
    });

    expect(await screen.findByRole("status", { name: "Preparing sandbox" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Session startup" })).toBeNull();
    expect(screen.queryByPlaceholderText("Ask anything")).toBeNull();
  });

  it("shows running setup while the trusted sandbox status is starting", async () => {
    const sandboxInstanceId = "sbi_test";
    const view = renderSessionWorkbenchPage({
      sandboxInstanceId,
      seededStatus: "starting",
    });

    await act(async () => {
      const status = {
        failureCode: null,
        failureMessage: null,
        id: sandboxInstanceId,
        sandboxProfileId: "sbp_test",
        sandboxProfileVersion: 1,
        triggerConversation: null,
        connectable: false,
        runtimeContext: null,
        startupOperation: {
          operationId: "owfr_session_startup_test",
          operationKind: "start",
        },
        status: "starting",
        title: "Test session",
      } satisfies SandboxInstanceStatusResult;

      view.queryClient.setQueryData(sandboxInstanceStatusQueryKey(sandboxInstanceId), status);
    });

    expect(await screen.findByRole("status", { name: "Running setup" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Session startup" })).toBeNull();
    expect(screen.queryByPlaceholderText("Ask anything")).toBeNull();
  });

  it("shows connecting chat while the sandbox is running but chat is not connected yet", async () => {
    const sandboxInstanceId = "sbi_test";
    const view = renderSessionWorkbenchPage({
      sandboxInstanceId,
      seededStatus: "running",
    });

    await act(async () => {
      const status = {
        failureCode: null,
        failureMessage: null,
        id: sandboxInstanceId,
        sandboxProfileId: "sbp_test",
        sandboxProfileVersion: 1,
        triggerConversation: null,
        connectable: true,
        runtimeContext: {
          agentRuntimeId: "codex",
          launchCwd: null,
          primaryRepositoryRoot: null,
        },
        startupOperation: {
          operationId: "owfr_session_startup_test",
          operationKind: "start",
        },
        status: "running",
        title: "Test session",
      } satisfies SandboxInstanceStatusResult;

      view.queryClient.setQueryData(sandboxInstanceStatusQueryKey(sandboxInstanceId), status);
    });

    expect(await screen.findByRole("status", { name: "Connecting chat" })).toBeTruthy();
  });
});
