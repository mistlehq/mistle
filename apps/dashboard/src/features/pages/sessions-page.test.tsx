// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import { seedAuthenticatedSession } from "../../test-support/auth-session.js";
import {
  buildOptimisticSessions,
  SandboxSessionStatusBadge,
  SessionsPage,
} from "./sessions-page.js";

describe("SessionsPage", () => {
  it("uses the authenticated user's display name for optimistic sessions", () => {
    const optimisticSessions = buildOptimisticSessions({
      launchedSessions: [
        {
          profileId: "sbp_profile_alpha",
          profileVersion: 3,
          sandboxInstanceId: "sbi_optimistic",
          createdAtIso: "2026-03-10T00:00:00.000Z",
          status: "starting",
          failureCode: null,
          failureMessage: null,
        },
      ],
      listedItems: [],
      currentUserId: "user-id",
      currentUserDisplayName: "Mistle User",
    });

    expect(optimisticSessions).toStrictEqual([
      {
        id: "sbi_optimistic",
        sandboxProfileId: "sbp_profile_alpha",
        sandboxProfileVersion: 3,
        status: "starting",
        startedBy: {
          kind: "user",
          id: "user-id",
          name: "Mistle User",
        },
        source: "dashboard",
        createdAt: "2026-03-10T00:00:00.000Z",
        updatedAt: "2026-03-10T00:00:00.000Z",
        failureCode: null,
        failureMessage: null,
      },
    ]);
  });

  it("renders sandbox launcher controls", async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });
    seedAuthenticatedSession(queryClient);

    const rendered = render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <SessionsPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    try {
      expect(screen.getByText("Start a new session")).toBeDefined();
      expect(screen.getByRole("combobox", { name: "Sandbox profile" })).toBeDefined();
      expect(screen.getByRole("button", { name: "Start session" })).toBeDefined();
      expect(screen.queryByText("Recent Sessions")).toBeNull();
      expect(screen.queryByText("No launched sessions yet.")).toBeNull();
    } finally {
      rendered.unmount();
      await queryClient.cancelQueries();
      queryClient.clear();
    }
  });

  it("uses the shared dashboard table styling for the session list", () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });
    seedAuthenticatedSession(queryClient);

    const markup = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <SessionsPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(markup).toContain('data-slot="table" class="w-full caption-bottom text-sm table-fixed"');
    expect(markup).toContain("bg-muted/60");
    expect(markup).toContain("text-xs font-semibold tracking-wide uppercase");
    expect(markup).toContain('<span class="sr-only">Actions</span>');
  });

  it("renders a compact failure indicator with tooltip details", () => {
    const markup = renderToStaticMarkup(
      <SandboxSessionStatusBadge
        status="failed"
        failureCode="INSTANCE_VOLUME_PROVISION_FAILED"
        failureMessage="Failed to provision instance volume before runtime startup."
      />,
    );

    expect(markup).toContain("View failure details");
    expect(markup).toContain("Failed");
    expect(markup).toContain("INSTANCE_VOLUME_PROVISION_FAILED");
    expect(markup).toContain("Failed to provision instance volume before runtime startup.");
    expect(markup).not.toContain("text-destructive whitespace-pre-wrap text-xs");
  });
});
