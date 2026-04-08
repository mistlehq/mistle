// @vitest-environment jsdom

import { QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it } from "vitest";

import { seedAuthenticatedSession } from "../../test-support/auth-session.js";
import { createTestQueryClient } from "../../test-support/query-client.js";
import { launchableSandboxProfilesQueryKey } from "../sandbox-profiles/sandbox-profiles-query-keys.js";
import type { LaunchableSandboxProfilesResult } from "../sandbox-profiles/sandbox-profiles-types.js";
import { NewSessionPage } from "./new-session-page.js";
import { buildStoryLaunchableSandboxProfile } from "./sessions-page.story-fixtures.js";

function installMatchMediaStub(): void {
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

function createNewSessionPageQueryClient(): ReturnType<typeof createTestQueryClient> {
  const queryClient = createTestQueryClient({
    refetchOnMount: false,
    staleTime: Number.POSITIVE_INFINITY,
  });

  seedAuthenticatedSession(queryClient);
  queryClient.setQueryData(launchableSandboxProfilesQueryKey(), {
    items: [
      buildStoryLaunchableSandboxProfile({
        id: "sbp_profile_alpha",
        displayName: "Alpha Profile",
      }),
      buildStoryLaunchableSandboxProfile({
        id: "sbp_profile_beta",
        displayName: "Beta Profile",
        latestVersion: 7,
      }),
    ],
  } satisfies LaunchableSandboxProfilesResult);

  return queryClient;
}

function renderNewSessionPage() {
  const queryClient = createNewSessionPageQueryClient();

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/sessions/new"]}>
        <Routes>
          <Route element={<NewSessionPage />} path="/sessions/new" />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
});

describe("NewSessionPage", () => {
  installMatchMediaStub();

  it("renders sandbox profile selection controls", () => {
    renderNewSessionPage();

    expect(screen.getByRole("heading", { name: "Start new session" })).toBeDefined();
    expect(screen.getByRole("combobox", { name: "Sandbox profile" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Start" })).toBeDefined();
  });

  it("shows the selected profile display name in the combobox input", () => {
    const rendered = renderNewSessionPage();

    const profileCombobox = screen.getByRole("combobox", { name: "Sandbox profile" });
    const profileTriggerButton = rendered.container.querySelector(
      'button[data-slot="input-group-button"]',
    );

    if (profileTriggerButton === null) {
      throw new Error("Expected sandbox profile trigger button.");
    }

    fireEvent.click(profileTriggerButton);
    fireEvent.click(screen.getByRole("option", { name: "Alpha Profile" }));

    expect((profileCombobox as HTMLInputElement).value).toBe("Alpha Profile");
  });
});
