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

function createNewSessionPageQueryClient(input?: {
  launchableProfiles?: LaunchableSandboxProfilesResult["items"];
}): ReturnType<typeof createTestQueryClient> {
  const queryClient = createTestQueryClient({
    refetchOnMount: false,
    staleTime: Number.POSITIVE_INFINITY,
  });

  seedAuthenticatedSession(queryClient);
  queryClient.setQueryData(launchableSandboxProfilesQueryKey(), {
    items: input?.launchableProfiles ?? [
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

function renderNewSessionPage(input?: {
  launchableProfiles?: LaunchableSandboxProfilesResult["items"];
  initialSelectedProfileId?: string;
}) {
  const queryClient = createNewSessionPageQueryClient(input);

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/sessions/new"]}>
        <Routes>
          <Route
            element={
              <NewSessionPage
                {...(input?.initialSelectedProfileId === undefined
                  ? {}
                  : { initialSelectedProfileId: input.initialSelectedProfileId })}
              />
            }
            path="/sessions/new"
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("NewSessionPage", () => {
  installMatchMediaStub();

  afterEach(() => {
    cleanup();
  });

  it("renders sandbox profile selection controls", () => {
    renderNewSessionPage();

    expect(screen.getByRole("heading", { name: "Start new session" })).toBeDefined();
    expect(screen.getByRole("combobox", { name: "Sandbox profile" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Start session" })).toBeDefined();
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

  it("shows a neutral notice and hides launch controls when no profiles are available", () => {
    renderNewSessionPage({
      launchableProfiles: [],
    });

    expect(screen.getByText("No launchable sandbox profiles are available yet.")).toBeDefined();
    expect(screen.queryByRole("combobox", { name: "Sandbox profile" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Start" })).toBeNull();
  });

  it("shows the starting repository picker for a selected multi-repo profile", () => {
    renderNewSessionPage({
      initialSelectedProfileId: "sbp_profile_alpha",
      launchableProfiles: [
        buildStoryLaunchableSandboxProfile({
          id: "sbp_profile_alpha",
          repositoryOptions: [
            {
              id: "/start/repo-1",
              label: "acme/repo-1",
              path: "/start/repo-1",
            },
            {
              id: "/start/repo-2",
              label: "acme/repo-2",
              path: "/start/repo-2",
            },
          ],
        }),
      ],
    });

    expect(screen.getByRole("combobox", { name: "Primary repository" })).toBeDefined();
    expect(
      (screen.getByRole("combobox", { name: "Primary repository" }) as HTMLInputElement).value,
    ).toBe("acme/repo-1");
    expect(
      screen.getByText((content) => content.includes("The agent will start its session in")),
    ).toBeDefined();
    expect(screen.getByText("/start/repo-1")).toBeDefined();
    expect(
      screen.getByText(
        "Git, diffs, and repo-local instructions will use this repository by default.",
      ),
    ).toBeDefined();
  });

  it("preselects the only repository when the selected profile has a single repo", () => {
    renderNewSessionPage({
      initialSelectedProfileId: "sbp_profile_alpha",
      launchableProfiles: [
        buildStoryLaunchableSandboxProfile({
          id: "sbp_profile_alpha",
          repositoryOptions: [
            {
              id: "/start/repo-1",
              label: "acme/repo-1",
              path: "/start/repo-1",
            },
          ],
        }),
      ],
    });

    expect(
      (screen.getByRole("combobox", { name: "Primary repository" }) as HTMLInputElement).value,
    ).toBe("acme/repo-1");
    expect(screen.getByText("/start/repo-1")).toBeDefined();
    expect(
      screen.getByText(
        "Git, diffs, and repo-local instructions will use this repository by default.",
      ),
    ).toBeDefined();
  });

  it("shows none as the only starting location when the selected profile has no repositories", () => {
    renderNewSessionPage({
      initialSelectedProfileId: "sbp_profile_alpha",
      launchableProfiles: [
        buildStoryLaunchableSandboxProfile({
          id: "sbp_profile_alpha",
          repositoryOptions: [],
        }),
      ],
    });

    expect(
      (screen.getByRole("combobox", { name: "Primary repository" }) as HTMLInputElement).value,
    ).toBe("None");
    expect(
      screen.getByText("The agent will start its session at the workspace root."),
    ).toBeDefined();
    expect(
      screen.getByText(
        "Git, diffs, and repo-local instructions will not be tied to a specific repository by default.",
      ),
    ).toBeDefined();
  });

  it("shows the selected repository sandbox path when a repository is chosen", () => {
    const rendered = renderNewSessionPage({
      initialSelectedProfileId: "sbp_profile_alpha",
      launchableProfiles: [
        buildStoryLaunchableSandboxProfile({
          id: "sbp_profile_alpha",
          repositoryOptions: [
            {
              id: "/root/acme/repo-1",
              label: "acme/repo-1",
              path: "/root/acme/repo-1",
            },
            {
              id: "/root/acme/repo-2",
              label: "acme/repo-2",
              path: "/root/acme/repo-2",
            },
          ],
        }),
      ],
    });

    const locationTriggerButton = rendered.container.querySelectorAll(
      'button[data-slot="input-group-button"]',
    )[1];

    if (locationTriggerButton === undefined) {
      throw new Error("Expected starting location trigger button.");
    }

    fireEvent.click(locationTriggerButton);
    fireEvent.click(screen.getByRole("option", { name: "acme/repo-2" }));

    expect(
      (screen.getByRole("combobox", { name: "Primary repository" }) as HTMLInputElement).value,
    ).toBe("acme/repo-2");
    expect(screen.getByText("/root/acme/repo-2")).toBeDefined();
    expect(
      screen.getByText(
        "Git, diffs, and repo-local instructions will use this repository by default.",
      ),
    ).toBeDefined();
  });
});
