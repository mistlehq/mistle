// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import { sandboxProfilesListQueryKey } from "../sandbox-profiles/sandbox-profiles-query-keys.js";
import type { SandboxProfilesListResult } from "../sandbox-profiles/sandbox-profiles-types.js";
import { SandboxProfilesPage } from "./sandbox-profiles-page.js";

function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        refetchOnMount: false,
        staleTime: Number.POSITIVE_INFINITY,
      },
    },
  });
}

describe("SandboxProfilesPage", () => {
  it("opens and closes the create profile dialog", () => {
    const queryClient = createQueryClient();
    const listResult: SandboxProfilesListResult = {
      items: [
        {
          createdAt: "2026-03-05T00:00:00.000Z",
          displayName: "Default Profile",
          id: "sbp_123",
          organizationId: "org_123",
          status: "active",
          updatedAt: "2026-03-05T00:00:00.000Z",
        },
      ],
      nextPage: null,
      previousPage: null,
      totalResults: 1,
    };

    queryClient.setQueryData(
      sandboxProfilesListQueryKey({
        limit: 20,
        after: null,
        before: null,
      }),
      listResult,
    );

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <SandboxProfilesPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(screen.queryByRole("heading", { name: "Create profile" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Create profile" }));

    expect(screen.getByRole("heading", { name: "Create profile" })).toBeDefined();
    expect(screen.getByRole("textbox")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("heading", { name: "Create profile" })).toBeNull();
  });

  it("uses the shared dashboard table styling for the profiles list", () => {
    const queryClient = createQueryClient();
    const listResult: SandboxProfilesListResult = {
      items: [
        {
          createdAt: "2026-03-05T00:00:00.000Z",
          displayName: "Default Profile",
          id: "sbp_123",
          organizationId: "org_123",
          status: "active",
          updatedAt: "2026-03-05T00:00:00.000Z",
        },
      ],
      nextPage: null,
      previousPage: null,
      totalResults: 1,
    };

    queryClient.setQueryData(
      sandboxProfilesListQueryKey({
        limit: 20,
        after: null,
        before: null,
      }),
      listResult,
    );

    const markup = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <SandboxProfilesPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(markup).toContain("min-w-[32rem] table-fixed");
    expect(markup).toContain("bg-muted/60");
    expect(markup).toContain("text-xs font-semibold tracking-wide uppercase");
  });

  it("renders the result summary even when there is only one page", () => {
    const queryClient = createQueryClient();
    const listResult: SandboxProfilesListResult = {
      items: [
        {
          createdAt: "2026-03-05T00:00:00.000Z",
          displayName: "Default Profile",
          id: "sbp_123",
          organizationId: "org_123",
          status: "active",
          updatedAt: "2026-03-05T00:00:00.000Z",
        },
      ],
      nextPage: null,
      previousPage: null,
      totalResults: 1,
    };

    queryClient.setQueryData(
      sandboxProfilesListQueryKey({
        limit: 20,
        after: null,
        before: null,
      }),
      listResult,
    );

    const markup = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <SandboxProfilesPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(markup).toContain("Showing 1 of 1");
    expect(markup).not.toContain(">Previous<");
    expect(markup).not.toContain(">Next<");
  });
});
