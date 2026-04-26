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
import type { SandboxProfileVersion } from "../sandbox-profiles/sandbox-profiles-types.js";
import {
  resolveSandboxProfileEditorVersionMode,
  SandboxProfileDefaultRedirect,
  SandboxProfileEditorPage,
  SandboxProfileEditorShell,
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
  view?: "published" | "draft" | "default";
  versionState?: "draft" | "draft-with-published" | "published" | "published-with-draft";
}): void {
  const queryClient = createTestQueryClient({
    refetchOnMount: false,
    staleTime: Number.POSITIVE_INFINITY,
  });
  const profileId = "sbp_test";
  const version = 3;

  const activeVersion =
    input?.versionState === "published" || input?.versionState === "published-with-draft"
      ? version
      : input?.versionState === "draft-with-published"
        ? version - 1
        : null;
  const resolvedVersionState = input?.versionState ?? "draft";
  const resolvedRouteView =
    input?.view ??
    (resolvedVersionState === "published" || resolvedVersionState === "published-with-draft"
      ? "published"
      : "draft");
  const singleVersionState: SandboxProfileVersion["state"] =
    resolvedVersionState === "published" ? "published" : "draft";
  const versions: SandboxProfileVersion[] =
    resolvedVersionState === "draft-with-published"
      ? [
          {
            sandboxProfileId: profileId,
            version: version - 1,
            state: "published",
            isActive: true,
          },
          {
            sandboxProfileId: profileId,
            version,
            state: "draft",
            isActive: false,
          },
        ]
      : resolvedVersionState === "published-with-draft"
        ? [
            {
              sandboxProfileId: profileId,
              version,
              state: "published",
              isActive: true,
            },
            {
              sandboxProfileId: profileId,
              version: version + 1,
              state: "draft",
              isActive: false,
            },
          ]
        : [
            {
              sandboxProfileId: profileId,
              version,
              state: singleVersionState,
              isActive: resolvedVersionState === "published",
            },
          ];

  queryClient.setQueryData(sandboxProfileDetailQueryKey(profileId), {
    id: profileId,
    displayName: "Prototype Profile",
    activeVersion,
    status: "active",
    latestVersion: version,
    createdAt: "2026-04-23T00:00:00.000Z",
    updatedAt: "2026-04-23T00:00:00.000Z",
  });
  if (input?.integrationsLoading === true) {
    queryClient.setQueryData(sandboxProfileVersionsQueryKey(profileId), {
      versions,
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
      versions,
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
        <Route element={<SandboxProfileEditorShell />} path="sandbox-profiles/:profileId">
          <Route element={<SandboxProfileDefaultRedirect />} index />
          <Route
            element={<SandboxProfileEditorPage mode="edit" view="published" />}
            path="published"
          />
          <Route element={<SandboxProfileEditorPage mode="edit" view="draft" />} path="draft" />
        </Route>
      </Route>,
    ),
    {
      initialEntries: [
        resolvedRouteView === "default"
          ? `/sandbox-profiles/${profileId}`
          : `/sandbox-profiles/${profileId}/${resolvedRouteView}`,
      ],
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
      isDeleteProfileDialogOpen={isOpen}
      mode={{
        kind: "active",
        version: 1,
        activeVersion: 1,
        hasDraft: false,
        draftVersion: null,
      }}
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

function DraftActionsHarness(input: { hasUnsavedIntegrationChanges?: boolean }): JSX.Element {
  const [discarded, setDiscarded] = useState(false);

  return (
    <SandboxProfileEditorView
      deleteProfileAutomationUsages={[]}
      deleteProfileAutomationUsagesError={null}
      deleteProfileAutomationUsagesIsPending={false}
      deleteProfileError={null}
      deleteProfileIsPending={false}
      hasUnsavedIntegrationChanges={input.hasUnsavedIntegrationChanges ?? false}
      isDeleteProfileDialogOpen={false}
      mode={{
        kind: "draft",
        version: 2,
        activeVersion: 1,
        hasDraft: true,
      }}
      onConfirmDeleteProfile={() => {}}
      onDeleteProfileDialogOpenChange={() => {}}
      onDiscardChangesAndLeaveDraft={() => {
        setDiscarded(true);
      }}
      onMakeChanges={() => {}}
      onPublish={() => {}}
      onSaveProfileName={async () => {}}
      onViewActive={() => {}}
      onViewDraft={() => {}}
      profileName="Draft profile"
      profileNameFallback="Draft profile"
      renderSectionPanel={() => <div>{discarded ? "Discarded" : "Not discarded"}</div>}
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

function PublishedWithDraftActionsHarness(): JSX.Element {
  const [discarded, setDiscarded] = useState(false);

  return (
    <SandboxProfileEditorView
      deleteProfileAutomationUsages={[]}
      deleteProfileAutomationUsagesError={null}
      deleteProfileAutomationUsagesIsPending={false}
      deleteProfileError={null}
      deleteProfileIsPending={false}
      hasUnsavedIntegrationChanges={false}
      isDeleteProfileDialogOpen={false}
      mode={{
        kind: "active",
        version: 1,
        activeVersion: 1,
        hasDraft: true,
        draftVersion: 2,
      }}
      onConfirmDeleteProfile={() => {}}
      onDeleteProfileDialogOpenChange={() => {}}
      onDiscardChangesAndLeaveDraft={() => {
        setDiscarded(true);
      }}
      onMakeChanges={() => {}}
      onPublish={() => {}}
      onSaveProfileName={async () => {}}
      onViewActive={() => {}}
      onViewDraft={() => {}}
      profileName="Published profile"
      profileNameFallback="Published profile"
      renderSectionPanel={() => <div>{discarded ? "Discarded" : "Not discarded"}</div>}
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

function renderDraftActionsHarness(input?: { hasUnsavedIntegrationChanges?: boolean }): void {
  const router = createMemoryRouter(
    createRoutesFromElements(<Route element={<DraftActionsHarness {...input} />} path="/" />),
  );

  render(<RouterProvider router={router} />);
}

function renderPublishedWithDraftActionsHarness(): void {
  const router = createMemoryRouter(
    createRoutesFromElements(<Route element={<PublishedWithDraftActionsHarness />} path="/" />),
  );

  render(<RouterProvider router={router} />);
}

describe("SandboxProfileEditorPage", () => {
  it("resolves the active version for the published route when draft and published versions both exist", () => {
    const result = resolveSandboxProfileEditorVersionMode({
      activeVersion: 1,
      view: "published",
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
        draftVersion: 2,
      },
    });
  });

  it("resolves the draft version for the draft route when the profile has not been published yet", () => {
    const result = resolveSandboxProfileEditorVersionMode({
      activeVersion: null,
      view: "draft",
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

  it("returns an explicit unavailable state when the published resolver has no published version", () => {
    const result = resolveSandboxProfileEditorVersionMode({
      activeVersion: null,
      view: "published",
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
      ok: false,
      message: "Sandbox profile published version could not be loaded.",
    });
  });

  it("can resolve the published version while a draft exists", () => {
    const result = resolveSandboxProfileEditorVersionMode({
      activeVersion: 1,
      view: "published",
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
        draftVersion: 2,
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

    expect(screen.getByText("Viewing: Published")).toBeDefined();
    expect(screen.getByRole("button", { name: "Edit" })).toBeDefined();
    expect(screen.getByRole("combobox", { name: "agent harness connection" })).toHaveProperty(
      "disabled",
      true,
    );
  });

  it("renders published profiles with existing drafts as resumable", () => {
    renderSandboxProfileEditor({
      versionState: "published-with-draft",
    });

    expect(screen.getByText("Viewing: Published")).toBeDefined();
    expect(screen.getByRole("button", { name: "Resume editing" })).toBeDefined();
  });

  it("shows discard draft in the published actions menu when a draft exists", () => {
    renderPublishedWithDraftActionsHarness();

    fireEvent.click(screen.getByRole("button", { name: "More actions" }));

    expect(screen.getByRole("menuitem", { name: "Discard draft" })).toBeDefined();
    expect(screen.getByRole("menuitem", { name: "Delete profile" })).toBeDefined();
  });

  it("discards an existing draft from the published actions menu", () => {
    renderPublishedWithDraftActionsHarness();

    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Discard draft" }));

    expect(screen.getByText("Discarded")).toBeDefined();
  });

  it("renders draft profiles with publish action", () => {
    renderSandboxProfileEditor();

    expect(screen.getByText("Viewing: Draft")).toBeDefined();
    expect(screen.getByRole("button", { name: "Publish" })).toBeDefined();
  });

  it("does not offer discard for draft-only profiles", () => {
    renderSandboxProfileEditor();

    fireEvent.click(screen.getByRole("button", { name: "More actions" }));

    expect(screen.getAllByRole("menuitem").map((menuItem) => menuItem.textContent)).toEqual([
      "Delete profile",
    ]);
  });

  it("blocks draft version actions while draft changes are saving", () => {
    renderDraftActionsHarness({
      hasUnsavedIntegrationChanges: true,
    });

    expect(screen.getByRole("button", { name: "Saving..." })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "More actions" })).toHaveProperty("disabled", true);
  });

  it("shows draft actions for draft profiles with a published version", () => {
    renderSandboxProfileEditor({
      versionState: "draft-with-published",
    });

    fireEvent.click(screen.getByRole("button", { name: "More actions" }));

    expect(screen.getAllByRole("menuitem").map((menuItem) => menuItem.textContent)).toEqual([
      "View published",
      "Discard draft",
      "Delete profile",
    ]);
  });

  it("redirects the profile default route to published when a published version exists", async () => {
    renderSandboxProfileEditor({
      view: "default",
      versionState: "published",
    });

    expect(await screen.findByText("Viewing: Published")).toBeDefined();
  });

  it("redirects the profile default route to draft when only a draft exists", async () => {
    renderSandboxProfileEditor({
      view: "default",
      versionState: "draft",
    });

    expect(await screen.findByText("Viewing: Draft")).toBeDefined();
  });

  it("redirects the published route to draft when the profile has no published version", async () => {
    renderSandboxProfileEditor({
      view: "published",
      versionState: "draft",
    });

    expect(await screen.findByText("Viewing: Draft")).toBeDefined();
  });

  it("shows an explicit unavailable state when the draft route has no draft", () => {
    renderSandboxProfileEditor({
      view: "draft",
      versionState: "published",
    });

    expect(screen.getByText("Sandbox profile draft version could not be loaded.")).toBeDefined();
  });

  it("discards draft changes directly from the draft actions menu", () => {
    renderDraftActionsHarness();

    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Discard draft" }));

    expect(screen.getByText("Discarded")).toBeDefined();
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

    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete profile" }));

    expect(screen.getByRole("heading", { name: "Delete profile?" })).toBeDefined();
    expect(screen.getByText("Repository triage")).toBeDefined();
    expect(screen.getByText("Release notes")).toBeDefined();
    expect(screen.getByText("These automations use this profile and will break:")).toBeDefined();
    expect(
      screen.getByText("They will stop working until you delete or retarget them."),
    ).toBeDefined();
  });

  it("blocks profile deletion while automation usage context is loading", () => {
    renderDeleteProfileDialogHarness({
      automationUsagesIsPending: true,
    });

    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete profile" }));

    expect(screen.getByText("Loading automations...")).toBeDefined();
    expect(screen.getByRole("button", { name: "Delete profile" }).hasAttribute("disabled")).toBe(
      true,
    );
  });
});
