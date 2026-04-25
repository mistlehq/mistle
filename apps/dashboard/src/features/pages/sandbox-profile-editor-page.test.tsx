// @vitest-environment jsdom

import { QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState, type JSX } from "react";
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
  sandboxProfileIntegrationDirectoryQueryKey,
  sandboxProfileVersionIntegrationBindingsQueryKey,
  sandboxProfileVersionSetupScriptQueryKey,
  sandboxProfileVersionsQueryKey,
} from "../sandbox-profiles/sandbox-profiles-query-keys.js";
import {
  resolveSandboxProfileEditorVersionMode,
  SandboxProfileEditorPage,
  SandboxProfileEditorView,
} from "./sandbox-profile-editor-page.js";

afterEach(() => {
  cleanup();
  void cleanupTestQueryClients();
});

function renderSandboxProfileEditor(input?: {
  bindings?: readonly {
    id: string;
    connectionId: string;
    kind: "agent" | "git" | "connector";
    config: Record<string, unknown>;
  }[];
  connections?: readonly {
    id: string;
    displayName: string;
    targetKey: string;
    status: "active" | "error" | "revoked";
    config?: Record<string, unknown>;
  }[];
  setupScript?: string | null;
  targets?: readonly {
    targetKey: string;
    displayName: string;
    familyId: string;
    variantId: string;
    config: Record<string, unknown>;
    targetHealth: {
      configStatus: "valid" | "invalid";
    };
  }[];
  integrationsLoading?: boolean;
  versionState?: "draft" | "published";
}): void {
  const queryClient = createTestQueryClient({
    refetchOnMount: false,
    staleTime: Number.POSITIVE_INFINITY,
  });
  const profileId = "sbp_test";
  const version = 3;

  queryClient.setQueryData(sandboxProfileDetailQueryKey(profileId), {
    id: profileId,
    displayName: "Prototype Profile",
    activeVersion: input?.versionState === "published" ? version : null,
    status: "active",
    latestVersion: version,
    createdAt: "2026-04-23T00:00:00.000Z",
    updatedAt: "2026-04-23T00:00:00.000Z",
  });
  if (input?.integrationsLoading === true) {
    queryClient.setQueryData(sandboxProfileVersionsQueryKey(profileId), {
      versions: [
        {
          sandboxProfileId: profileId,
          version,
          state: input?.versionState ?? "draft",
          isActive: input?.versionState === "published",
        },
      ],
    });
    const bindingsQuery = queryClient.getQueryCache().build(queryClient, {
      queryKey: sandboxProfileVersionIntegrationBindingsQueryKey({
        profileId,
        version,
      }),
      queryFn: async () => ({
        bindings: [],
      }),
    });

    bindingsQuery.setState({
      ...bindingsQuery.state,
      data: undefined,
      fetchStatus: "fetching",
      status: "pending",
    });
  } else {
    queryClient.setQueryData(sandboxProfileVersionsQueryKey(profileId), {
      versions: [
        {
          sandboxProfileId: profileId,
          version,
          state: input?.versionState ?? "draft",
          isActive: input?.versionState === "published",
        },
      ],
    });
    queryClient.setQueryData(
      sandboxProfileVersionIntegrationBindingsQueryKey({
        profileId,
        version,
      }),
      {
        bindings: input?.bindings ?? [],
      },
    );
  }
  queryClient.setQueryData(sandboxProfileIntegrationDirectoryQueryKey(), {
    connections: input?.connections ?? [],
    targets: input?.targets ?? [],
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

function DeleteProfileDialogHarness(input: {
  automationUsages?: readonly {
    id: string;
    name: string;
  }[];
  automationUsagesError?: string | null;
  automationUsagesIsPending?: boolean;
}): JSX.Element {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <SandboxProfileEditorView
      deleteProfileAutomationUsages={input.automationUsages ?? []}
      deleteProfileAutomationUsagesError={input.automationUsagesError ?? null}
      deleteProfileAutomationUsagesIsPending={input.automationUsagesIsPending ?? false}
      deleteProfileError={null}
      deleteProfileIsPending={false}
      hasUnsavedIntegrationChanges={false}
      isCancelDraftDialogOpen={false}
      isDeleteProfileDialogOpen={isOpen}
      mode={{
        kind: "active",
        version: 1,
        activeVersion: 1,
        hasDraft: false,
      }}
      onCancelDraftDialogOpenChange={() => {}}
      onConfirmDeleteProfile={() => {}}
      onDeleteProfileDialogOpenChange={setIsOpen}
      onDiscardChangesAndLeaveDraft={() => {}}
      onMakeChanges={() => {}}
      onPublish={() => {}}
      onSaveProfileName={async () => {}}
      onViewActive={() => {}}
      onViewDraft={() => {}}
      profileName="Production profile"
      profileNameFallback="Production profile"
      renderSectionPanel={() => <div>Section panel</div>}
      sections={[
        {
          id: "integrations",
          label: "Integrations",
        },
      ]}
      versionActionError={null}
      versionActionIsPending={false}
    />
  );
}

function renderDeleteProfileDialogHarness(input: {
  automationUsages?: readonly {
    id: string;
    name: string;
  }[];
  automationUsagesError?: string | null;
  automationUsagesIsPending?: boolean;
}): void {
  const router = createMemoryRouter(
    createRoutesFromElements(
      <Route element={<DeleteProfileDialogHarness {...input} />} path="/" />,
    ),
  );

  render(<RouterProvider router={router} />);
}

describe("SandboxProfileEditorPage", () => {
  it("defaults to the active version when draft and published versions both exist", () => {
    const result = resolveSandboxProfileEditorVersionMode({
      activeVersion: 1,
      viewedVersionKind: null,
      versions: [
        {
          sandboxProfileId: "sbp_test",
          version: 1,
          state: "published",
          isActive: true,
        },
        {
          sandboxProfileId: "sbp_test",
          version: 2,
          state: "draft",
          isActive: false,
        },
      ],
    });

    expect(result).toEqual({
      ok: true,
      mode: {
        kind: "active",
        version: 1,
        activeVersion: 1,
        hasDraft: true,
      },
    });
  });

  it("defaults to draft when the profile has not been published yet", () => {
    const result = resolveSandboxProfileEditorVersionMode({
      activeVersion: null,
      viewedVersionKind: null,
      versions: [
        {
          sandboxProfileId: "sbp_test",
          version: 1,
          state: "draft",
          isActive: false,
        },
      ],
    });

    expect(result).toEqual({
      ok: true,
      mode: {
        kind: "draft",
        version: 1,
        activeVersion: null,
        hasDraft: true,
      },
    });
  });

  it("can resolve the published version while a draft exists", () => {
    const result = resolveSandboxProfileEditorVersionMode({
      activeVersion: 1,
      viewedVersionKind: "active",
      versions: [
        {
          sandboxProfileId: "sbp_test",
          version: 1,
          state: "published",
          isActive: true,
        },
        {
          sandboxProfileId: "sbp_test",
          version: 2,
          state: "draft",
          isActive: false,
        },
      ],
    });

    expect(result).toEqual({
      ok: true,
      mode: {
        kind: "active",
        version: 1,
        activeVersion: 1,
        hasDraft: true,
      },
    });
  });

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

  it("shows stale git guidance when a persisted git binding cannot be resolved", () => {
    renderSandboxProfileEditor({
      bindings: [
        {
          id: "binding-git",
          connectionId: "missing-git-connection",
          kind: "git",
          config: {},
        },
      ],
    });

    fireEvent.click(screen.getByRole("tab", { name: "Resources & Tools" }));

    expect(
      screen.getByText(
        "Fix the Git provider in Integrations before selecting repository resources.",
      ),
    ).toBeDefined();
  });

  it("shows no loading placeholder in resources and tools while integrations are loading", () => {
    renderSandboxProfileEditor({
      integrationsLoading: true,
    });

    fireEvent.click(screen.getByRole("tab", { name: "Resources & Tools" }));

    expect(screen.queryByText("Loading integrations and resources...")).toBeNull();
    expect(
      screen.queryByText(
        "Choose a Git provider in Integrations before selecting repository resources.",
      ),
    ).toBeNull();
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

  it("renders published profiles as read-only", () => {
    renderSandboxProfileEditor({
      versionState: "published",
      bindings: [
        {
          id: "binding-agent",
          connectionId: "connection-agent",
          kind: "agent",
          config: {},
        },
      ],
      connections: [
        {
          id: "connection-agent",
          displayName: "Codex connection",
          targetKey: "codex",
          status: "active",
        },
      ],
      targets: [
        {
          targetKey: "codex",
          displayName: "Codex",
          familyId: "agent",
          variantId: "default",
          config: {},
          targetHealth: {
            configStatus: "valid",
          },
        },
      ],
    });

    expect(screen.getByText("Published")).toBeDefined();
    expect(screen.getByRole("button", { name: "Make changes" })).toBeDefined();
    expect(screen.getByRole("combobox", { name: "agent harness connection" })).toHaveProperty(
      "disabled",
      true,
    );
  });

  it("renders draft profiles with publish action", () => {
    renderSandboxProfileEditor();

    expect(screen.getByRole("button", { name: "Publish Changes" })).toBeDefined();
  });

  it("confirms profile deletion with automation usage context", () => {
    renderDeleteProfileDialogHarness({
      automationUsages: [
        {
          id: "atm_triage",
          name: "Repository triage",
        },
        {
          id: "atm_release",
          name: "Release notes",
        },
      ],
    });

    fireEvent.click(screen.getByRole("button", { name: "More profile actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete profile" }));

    expect(screen.getByRole("heading", { name: "Delete profile?" })).toBeDefined();
    expect(screen.getByText("Repository triage")).toBeDefined();
    expect(screen.getByText("Release notes")).toBeDefined();
    expect(screen.getByText("All of these automations will be removed.")).toBeDefined();
  });

  it("blocks profile deletion while automation usage context is loading", () => {
    renderDeleteProfileDialogHarness({
      automationUsagesIsPending: true,
    });

    fireEvent.click(screen.getByRole("button", { name: "More profile actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete profile" }));

    expect(screen.getByText("Loading automations...")).toBeDefined();
    expect(screen.getByRole("button", { name: "Delete profile" }).hasAttribute("disabled")).toBe(
      true,
    );
  });
});
