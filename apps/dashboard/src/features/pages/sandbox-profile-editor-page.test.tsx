// @vitest-environment jsdom

import { QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import {
  createMemoryRouter,
  createRoutesFromElements,
  Outlet,
  Route,
  RouterProvider,
} from "react-router";
import { afterEach, describe, expect, it } from "vitest";

import { cleanupTestQueryClients, createTestQueryClient } from "../../test-support/query-client.js";
import {
  sandboxProfileDetailQueryKey,
  sandboxProfileVersionIntegrationBindingsQueryKey,
  sandboxProfileVersionSetupScriptQueryKey,
  sandboxProfileVersionsQueryKey,
} from "../sandbox-profiles/sandbox-profiles-query-keys.js";
import { SandboxProfileEditorPage } from "./sandbox-profile-editor-page.js";

afterEach(() => {
  cleanup();
  void cleanupTestQueryClients();
});

function renderSandboxProfileEditor(input?: { setupScript?: string | null }): void {
  const queryClient = createTestQueryClient({
    refetchOnMount: false,
    staleTime: Number.POSITIVE_INFINITY,
  });
  const profileId = "sbp_test";
  const version = 3;

  queryClient.setQueryData(sandboxProfileDetailQueryKey(profileId), {
    id: profileId,
    displayName: "Prototype Profile",
    status: "active",
    latestVersion: version,
    createdAt: "2026-04-23T00:00:00.000Z",
    updatedAt: "2026-04-23T00:00:00.000Z",
  });
  queryClient.setQueryData(sandboxProfileVersionsQueryKey(profileId), {
    versions: [{ sandboxProfileId: profileId, version }],
  });
  queryClient.setQueryData(
    sandboxProfileVersionIntegrationBindingsQueryKey({
      profileId,
      version,
    }),
    {
      bindings: [],
    },
  );
  queryClient.setQueryData(["sandbox-profiles", "integration-directory"], {
    connections: [],
    targets: [],
  });
  queryClient.setQueryData(
    sandboxProfileVersionSetupScriptQueryKey({
      profileId,
      version,
    }),
    {
      sandboxProfileId: profileId,
      version,
      setupScript:
        input?.setupScript === undefined ? "pnpm install\npnpm dev:bootstrap" : input.setupScript,
    },
  );
  const router = createMemoryRouter(
    createRoutesFromElements(
      <Route element={<Outlet />} path="/">
        <Route
          element={<SandboxProfileEditorPage mode="edit" />}
          path="sandbox-profiles/:profileId"
        />
      </Route>,
    ),
    {
      initialEntries: [`/sandbox-profiles/${profileId}`],
    },
  );

  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

describe("SandboxProfileEditorPage", () => {
  it("renders the setup-flow sections in the editor rail", () => {
    renderSandboxProfileEditor();

    expect(screen.getByRole("tab", { name: "Integrations" })).toBeDefined();
    expect(screen.getByRole("tab", { name: "Resources & Tools" })).toBeDefined();
    expect(screen.getByRole("tab", { name: "Configurations" })).toBeDefined();
  });

  it("shows resources guidance when no git provider is configured", () => {
    renderSandboxProfileEditor();

    fireEvent.click(screen.getByRole("tab", { name: "Resources & Tools" }));

    expect(
      screen.getByText(
        "Choose a Git provider in Integrations before selecting repository resources.",
      ),
    ).toBeDefined();
  });

  it("shows the setup script editor in the configurations section", () => {
    renderSandboxProfileEditor();

    fireEvent.click(screen.getByRole("tab", { name: "Configurations" }));

    const configurationsPanel = screen.getByRole("tabpanel", {
      name: "Configurations",
      hidden: false,
    });
    const editor = within(configurationsPanel).getByRole("textbox", {
      name: "Setup script",
    });

    expect(editor.textContent).toContain("pnpm install");
    expect(editor.textContent).toContain("pnpm dev:bootstrap");
  });

  it("renders an empty setup script editor when no script is configured", () => {
    renderSandboxProfileEditor({ setupScript: null });

    fireEvent.click(screen.getByRole("tab", { name: "Configurations" }));

    const configurationsPanel = screen.getByRole("tabpanel", {
      name: "Configurations",
      hidden: false,
    });
    const editor = within(configurationsPanel).getByRole("textbox", {
      name: "Setup script",
    });
    const editorRoot = editor.closest('[data-slot="sandbox-setup-script-editor"]');

    expect(editorRoot?.getAttribute("data-editor-state")).toBe("empty");
  });
});
