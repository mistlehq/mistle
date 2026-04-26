// @vitest-environment jsdom

import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import { createTestQueryClient } from "../../test-support/query-client.js";
import { sandboxProfilesListQueryKey } from "../sandbox-profiles/sandbox-profiles-query-keys.js";
import type { SandboxProfilesListResult } from "../sandbox-profiles/sandbox-profiles-types.js";
import { SandboxProfilesPage } from "./sandbox-profiles-page.js";

describe("SandboxProfilesPage", () => {
  it("opens and closes the create profile dialog", () => {
    const queryClient = createTestQueryClient({
      refetchOnMount: false,
      staleTime: Number.POSITIVE_INFINITY,
    });
    const listResult: SandboxProfilesListResult = {
      items: [
        {
          activeVersion: null,
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
    const queryClient = createTestQueryClient({
      refetchOnMount: false,
      staleTime: Number.POSITIVE_INFINITY,
    });
    const listResult: SandboxProfilesListResult = {
      items: [
        {
          activeVersion: null,
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

    expect(markup).toContain('data-slot="table-container" class="relative w-full overflow-x-auto"');
    expect(markup).toContain(
      'data-slot="table" class="w-full caption-bottom text-sm min-w-[40rem]"',
    );
    expect(markup).toContain("bg-muted/60");
    expect(markup).toContain("text-xs font-semibold tracking-wide uppercase");
  });

  it("renders profile publication status without pagination when there is only one page", () => {
    const queryClient = createTestQueryClient({
      refetchOnMount: false,
      staleTime: Number.POSITIVE_INFINITY,
    });
    const listResult: SandboxProfilesListResult = {
      items: [
        {
          activeVersion: null,
          createdAt: "2026-03-05T00:00:00.000Z",
          displayName: "Draft profile",
          id: "sbp_123",
          organizationId: "org_123",
          status: "active",
          updatedAt: "2026-03-05T00:00:00.000Z",
        },
        {
          activeVersion: 1,
          createdAt: "2026-03-05T00:00:00.000Z",
          displayName: "Published profile",
          id: "sbp_456",
          organizationId: "org_123",
          status: "active",
          updatedAt: "2026-03-05T00:00:00.000Z",
        },
      ],
      nextPage: null,
      previousPage: null,
      totalResults: 2,
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

    expect(screen.getByRole("button", { name: "Draft profile" })).toBeDefined();
    expect(screen.getByText("Not published")).toBeDefined();
    expect(screen.getByRole("button", { name: "Published profile" })).toBeDefined();
    expect(screen.getByText("Published")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Previous" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Next" })).toBeNull();
  });
});
