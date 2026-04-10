// @vitest-environment jsdom

import { systemSleeper } from "@mistle/time";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, createRoutesFromElements, Route, RouterProvider } from "react-router";
import { afterEach, describe, expect, it } from "vitest";

import { OrganizationMembersSettingsPage } from "../src/features/pages/organization-members-settings-page.js";
import { DEFAULT_SEARCH_DEBOUNCE_MS } from "../src/features/shared/use-debounced-value.js";
import { renderDashboardPageIntegration } from "./helpers/dashboard-page.js";

type MembersRequest = {
  offset: string | null;
  search: string | null;
};

function createRouter(): ReturnType<typeof createMemoryRouter> {
  return createMemoryRouter(
    createRoutesFromElements(
      <Route
        element={<OrganizationMembersSettingsPage />}
        handle={{
          title: "Members",
          description: "",
        }}
        path="/settings/members"
      />,
    ),
    {
      initialEntries: ["/settings/members"],
    },
  );
}

function buildMembershipCapabilitiesResponse() {
  return {
    organizationId: "org_123",
    actorRole: "admin",
    invite: {
      canExecute: true,
      assignableRoles: ["admin", "member"],
    },
    memberRoleUpdate: {
      canExecute: true,
      roleTransitionMatrix: {
        owner: [],
        admin: ["admin", "member"],
        member: ["admin", "member"],
      },
    },
  };
}

function buildMembersPageResponse(input: { offset: number; search: string }) {
  if (input.search.length > 0) {
    return {
      members: [
        {
          id: "mem_search",
          userId: "user_search",
          name: `Matched ${input.search}`,
          email: `${input.search}@mistle.so`,
          role: "member",
          joinedAt: "2026-02-01T00:00:00.000Z",
          avatar: {
            hasImage: false,
            imageUrl: null,
          },
        },
      ],
      limit: 25,
      offset: input.offset,
      total: 1,
    };
  }

  const startIndex = input.offset;
  const endIndex = Math.min(startIndex + 25, 30);
  const members = [];

  for (let index = startIndex; index < endIndex; index += 1) {
    members.push({
      id: `mem_${index + 1}`,
      userId: `user_${index + 1}`,
      name: `Member ${index + 1}`,
      email: `member-${index + 1}@mistle.so`,
      role: "member",
      joinedAt: "2026-02-01T00:00:00.000Z",
      avatar: {
        hasImage: false,
        imageUrl: null,
      },
    });
  }

  return {
    members,
    limit: 25,
    offset: input.offset,
    total: 30,
  };
}

function buildInvitationsPageResponse() {
  return {
    invitations: [],
    limit: 25,
    offset: 0,
    total: 0,
  };
}

async function sleep(durationMs: number): Promise<void> {
  await systemSleeper.sleep(durationMs);
}

describe("OrganizationMembersSettingsPage search", () => {
  afterEach(() => {
    cleanup();
  });

  it("debounces member search requests and resets pagination before the refetch", async () => {
    const memberRequests: MembersRequest[] = [];

    const renderedPage = await renderDashboardPageIntegration({
      handler: (request, response) => {
        const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");

        if (
          request.method === "GET" &&
          requestUrl.pathname === "/v1/organizations/org_123/membership-capabilities"
        ) {
          response.writeHead(200, { "content-type": "application/json" });
          response.end(JSON.stringify(buildMembershipCapabilitiesResponse()));
          return;
        }

        if (
          request.method === "GET" &&
          requestUrl.pathname === "/v1/organizations/org_123/members"
        ) {
          memberRequests.push({
            offset: requestUrl.searchParams.get("offset"),
            search: requestUrl.searchParams.get("search"),
          });

          response.writeHead(200, { "content-type": "application/json" });
          response.end(
            JSON.stringify(
              buildMembersPageResponse({
                offset: Number(requestUrl.searchParams.get("offset") ?? "0"),
                search: requestUrl.searchParams.get("search") ?? "",
              }),
            ),
          );
          return;
        }

        if (
          request.method === "GET" &&
          requestUrl.pathname === "/v1/organizations/org_123/invitations"
        ) {
          response.writeHead(200, { "content-type": "application/json" });
          response.end(JSON.stringify(buildInvitationsPageResponse()));
          return;
        }

        response.writeHead(404, { "content-type": "application/json" });
        response.end(JSON.stringify({ message: "Not found" }));
      },
      ui: <RouterProvider router={createRouter()} />,
    });

    try {
      await screen.findByText("Member 1");

      expect(memberRequests).toEqual([
        {
          offset: "0",
          search: "",
        },
      ]);

      fireEvent.click(screen.getByRole("button", { name: "Next" }));

      await waitFor(() => {
        expect(
          memberRequests.some((request) => request.offset === "25" && request.search === ""),
        ).toBe(true);
      });

      const requestCountBeforeSearch = memberRequests.length;

      fireEvent.change(screen.getByRole("textbox", { name: "Search" }), {
        target: {
          value: "repo",
        },
      });

      await sleep(Math.max(50, DEFAULT_SEARCH_DEBOUNCE_MS / 2));

      expect(memberRequests).toHaveLength(requestCountBeforeSearch);

      await waitFor(
        () => {
          expect(memberRequests.at(-1)).toEqual({
            offset: "0",
            search: "repo",
          });
        },
        {
          timeout: DEFAULT_SEARCH_DEBOUNCE_MS + 500,
        },
      );

      await screen.findByText("Matched repo");
    } finally {
      await renderedPage.close();
    }
  });
});
