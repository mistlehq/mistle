// @vitest-environment jsdom

/*
Temporarily commented out until test environment is configured with
VITE_CONTROL_PLANE_API_ORIGIN for members API flows.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  toMembersLoadErrorMessage,
  useOrganizationMembersSettingsState,
} from "./use-organization-members-settings-state.js";

describe("useOrganizationMembersSettingsState", () => {
  it("toggles invite dialog open state", () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });
    const { result } = renderHook(
      () =>
        useOrganizationMembersSettingsState({
          organizationId: "org_1",
        }),
      {
        wrapper: ({ children }) => (
          <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
        ),
      },
    );

    expect(result.current.inviteDialogOpen).toBe(false);

    act(() => {
      result.current.setInviteDialogOpen(true);
    });

    expect(result.current.inviteDialogOpen).toBe(true);
  });
});

describe("toMembersLoadErrorMessage", () => {
  it("prefers members error when members query failed", () => {
    const message = toMembersLoadErrorMessage({
      membersError: new Error("Members broke"),
      invitationsError: new Error("Invitations broke"),
      hasMembersError: true,
    });

    expect(message).toBe("Members broke");
  });
});
*/
