// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";

import type {
  SandboxProviderSummary,
  SandboxProfileVersion,
} from "../sandbox-profiles/sandbox-profiles-types.js";
import type { ApiKey } from "../settings/api-keys/api-keys-service.js";
import {
  createDefaultMistleSandboxRuntimeConfig,
  resolveManagedSandboxProvider,
} from "./sandbox-profile-runtime-defaults.js";
import {
  SandboxProfileRuntimeSection,
  type SandboxProfileRuntimeDraftState,
} from "./sandbox-profile-runtime-section.js";

afterEach(() => {
  cleanup();
});

const DockerProvider = {
  id: "docker",
  displayName: "Docker",
  managed: true,
  supportsOrganizationConnection: false,
  resourceCapabilities: null,
} satisfies SandboxProviderSummary;

const E2BProvider = {
  id: "e2b",
  displayName: "E2B",
  managed: true,
  supportsOrganizationConnection: true,
  resourceCapabilities: {
    vcpuCount: {
      min: 1,
      max: 8,
      step: 1,
      default: 2,
    },
    memoryMb: {
      min: 1024,
      max: 16_384,
      step: 1024,
      default: 4096,
    },
  },
} satisfies SandboxProviderSummary;

const OrganizationE2BProvider = {
  ...E2BProvider,
  managed: false,
} satisfies SandboxProviderSummary;

const TensorlakeProvider = {
  id: "tensorlake",
  displayName: "Tensorlake",
  managed: true,
  supportsOrganizationConnection: true,
  resourceCapabilities: {
    vcpuCount: {
      min: 1,
      max: 8,
      step: 1,
      default: 1,
    },
    memoryMb: {
      min: 1024,
      max: 65536,
      step: 1024,
      default: 1024,
      minPerVcpu: 1024,
      maxPerVcpu: 8192,
    },
    diskMb: {
      min: 10240,
      max: 102400,
      step: 1024,
      default: 10240,
    },
  },
} satisfies SandboxProviderSummary;

const OrganizationStorageE2BProvider = {
  id: "e2b",
  displayName: "E2B",
  managed: false,
  supportsOrganizationConnection: true,
  resourceCapabilities: {
    vcpuCount: {
      min: 1,
      max: 16,
      step: 1,
      default: 4,
    },
    memoryMb: {
      min: 1024,
      max: 16384,
      step: 1024,
      default: 8192,
    },
    diskMb: {
      min: 10240,
      max: 102400,
      step: 1024,
      default: 20480,
    },
  },
} satisfies SandboxProviderSummary;

const E2BRuntimeConnection = {
  id: "icn_e2b_runtime_test",
  displayName: "E2B Production",
  targetKey: "e2b-default",
  status: "active",
  config: {},
} as const;

const E2BRuntimeTarget = {
  targetKey: "e2b-default",
  displayName: "E2B",
  familyId: "e2b",
  variantId: "e2b-default",
  config: {},
  targetHealth: {
    configStatus: "valid",
  },
} as const;

const MistleApiKey = {
  id: "apk_runtime_section_mistle",
  name: "Mistle MCP key",
  secretPrefix: "prefix",
  permissions: ["sandboxProfile:read"],
  expiresAt: null,
  lastUsedAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
} satisfies ApiKey;

function createVersion(
  input: Pick<
    SandboxProfileVersion,
    "sandboxProvider" | "sandboxConnectionId" | "sandboxResources"
  > & {
    agentRuntimeId?: SandboxProfileVersion["agentRuntimeId"];
    mistleMcpEnabled?: boolean;
    mistleMcpApiKeyId?: string | null;
  },
): SandboxProfileVersion {
  return {
    sandboxProfileId: "sbp_runtime_section_test",
    version: 1,
    state: "draft",
    publishedAt: null,
    agentRuntimeId: input.agentRuntimeId ?? "codex",
    gitCommitSigningIntegrationConnectionId: null,
    mistleMcpEnabled: input.mistleMcpEnabled ?? false,
    mistleMcpApiKeyId: input.mistleMcpApiKeyId ?? null,
    sandboxProvider: input.sandboxProvider,
    sandboxConnectionId: input.sandboxConnectionId,
    maintenanceScript: null,
    sandboxResources: input.sandboxResources,
    skillsConfig: null,
    isActive: false,
    usable: false,
    latestSnapshotJob: null,
    refreshSchedule: null,
  };
}

describe("SandboxProfileRuntimeSection", () => {
  it("renders Mistle as a sandbox provider without exposing the underlying provider name", () => {
    render(
      <SandboxProfileRuntimeSection
        apiKeys={[]}
        availableConnections={[]}
        availableTargets={[]}
        disabled={false}
        isDraft={true}
        providers={[E2BProvider]}
        version={createVersion({
          sandboxProvider: "e2b",
          sandboxConnectionId: null,
          sandboxResources: {
            vcpuCount: 2,
            memoryMb: 4096,
          },
        })}
      />,
    );

    expect(screen.getByRole("combobox", { name: "Agent" })).toBeTruthy();
    expect(screen.getByText("Codex")).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Sandbox provider" })).toBeTruthy();
    expect(screen.getAllByText("Mistle").length).toBeGreaterThan(0);
    expect(
      screen
        .getByRole("combobox", { name: "Sandbox provider" })
        .querySelector('img[src="/brand/logo.webp"]'),
    ).not.toBeNull();
    expect(screen.queryByText("E2B")).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Credentials" })).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Connection" })).toBeNull();
    expect(screen.queryByText("E2B (Managed)")).toBeNull();
  });

  it("renders OpenCode as the selected profile agent runtime", () => {
    render(
      <SandboxProfileRuntimeSection
        apiKeys={[]}
        availableConnections={[]}
        availableTargets={[]}
        disabled={false}
        isDraft={true}
        providers={[DockerProvider]}
        version={createVersion({
          agentRuntimeId: "opencode",
          sandboxProvider: "docker",
          sandboxConnectionId: null,
          sandboxResources: null,
        })}
      />,
    );

    expect(screen.getByRole("combobox", { name: "Agent" })).toBeTruthy();
    expect(screen.getByText("OpenCode")).toBeTruthy();
  });

  it("renders Mistle resources as an API key selector in the Agent section", () => {
    render(
      <SandboxProfileRuntimeSection
        apiKeys={[MistleApiKey]}
        availableConnections={[]}
        availableTargets={[]}
        disabled={false}
        isDraft={true}
        providers={[DockerProvider]}
        version={createVersion({
          sandboxProvider: "docker",
          sandboxConnectionId: null,
          sandboxResources: null,
        })}
      />,
    );

    expect(screen.queryByRole("switch")).toBeNull();
    expect(screen.getByRole("combobox", { name: "Mistle resources" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Explain Mistle resources" })).toBeTruthy();
    expect(screen.getByText("None")).toBeTruthy();

    fireEvent.click(screen.getByRole("combobox", { name: "Mistle resources" }));

    expect(screen.getByRole("option", { name: "None" })).toBeTruthy();
    const createApiKeyOption = screen.getByRole("option", { name: "Create new API key" });
    expect(createApiKeyOption).toBeTruthy();
    expect(createApiKeyOption.previousElementSibling?.getAttribute("data-slot")).toBe(
      "select-separator",
    );
    expect(screen.getByRole("option", { name: "Mistle MCP key" })).toBeTruthy();
  });

  it("shows API key creation instead of a selector when no API keys exist", () => {
    render(
      <SandboxProfileRuntimeSection
        apiKeys={[]}
        availableConnections={[]}
        availableTargets={[]}
        disabled={false}
        isDraft={true}
        providers={[DockerProvider]}
        version={createVersion({
          sandboxProvider: "docker",
          sandboxConnectionId: null,
          sandboxResources: null,
        })}
      />,
    );

    expect(screen.getByText("Mistle resources")).toBeTruthy();
    expect(screen.queryByRole("combobox", { name: "Mistle resources" })).toBeNull();
    expect(screen.getByRole("button", { name: "Create new API key" })).toBeTruthy();
  });

  it("summarizes allowed Mistle resources for the selected API key", () => {
    render(
      <SandboxProfileRuntimeSection
        apiKeys={[MistleApiKey]}
        availableConnections={[]}
        availableTargets={[]}
        disabled={false}
        isDraft={true}
        providers={[DockerProvider]}
        version={createVersion({
          sandboxProvider: "docker",
          sandboxConnectionId: null,
          sandboxResources: null,
          mistleMcpEnabled: true,
          mistleMcpApiKeyId: MistleApiKey.id,
        })}
      />,
    );

    expect(screen.getByText("1 resource")).toBeTruthy();
    expect(screen.queryByText("sandboxProfile:read")).toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: "View allowed Mistle resources: 1 resource" }),
    );

    expect(screen.getByRole("dialog", { name: "Allowed Mistle resources" })).toBeTruthy();
    expect(
      screen.getByText(
        "This profile's agent can use Mistle MCP key for these Mistle resources. Access is limited by that API key's permissions.",
      ),
    ).toBeTruthy();
    expect(screen.getByText("Sandbox profiles")).toBeTruthy();
    expect(screen.getByText("Read sandbox profiles")).toBeTruthy();
    expect(screen.queryByText("View sandbox profile configuration.")).toBeNull();
    expect(screen.queryByText("sandboxProfile:read")).toBeNull();
  });

  it("opens API key creation in a dialog from the zero-key state", () => {
    render(
      <SandboxProfileRuntimeSection
        apiKeys={[]}
        availableConnections={[]}
        availableTargets={[]}
        disabled={false}
        isDraft={true}
        onCreateApiKey={async () => ({
          apiKey: MistleApiKey,
          token: "mstl_apk_test",
        })}
        providers={[DockerProvider]}
        version={createVersion({
          sandboxProvider: "docker",
          sandboxConnectionId: null,
          sandboxResources: null,
          mistleMcpEnabled: true,
        })}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Create new API key" }));

    expect(screen.getByRole("dialog", { name: "Create new API key" })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Name" })).toBeTruthy();
    expect(screen.getByText("4 selected")).toBeTruthy();
    expect(screen.getByText("Read sandbox profiles")).toBeTruthy();
    expect(screen.queryByText("View sandbox profile configuration.")).toBeNull();

    fireEvent.click(screen.getByRole("checkbox", { name: "Select all" }));

    expect(screen.getByText("12 selected")).toBeTruthy();
  });

  it("opens API key creation from the Mistle resources selector", () => {
    render(
      <SandboxProfileRuntimeSection
        apiKeys={[MistleApiKey]}
        availableConnections={[]}
        availableTargets={[]}
        disabled={false}
        isDraft={true}
        onCreateApiKey={async () => ({
          apiKey: MistleApiKey,
          token: "mstl_apk_test",
        })}
        providers={[DockerProvider]}
        version={createVersion({
          sandboxProvider: "docker",
          sandboxConnectionId: null,
          sandboxResources: null,
        })}
      />,
    );

    fireEvent.click(screen.getByRole("combobox", { name: "Mistle resources" }));
    fireEvent.click(screen.getByRole("option", { name: "Create new API key" }));

    expect(screen.getByRole("dialog", { name: "Create new API key" })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Name" })).toBeTruthy();
  });

  it("selects a newly created API key and still shows the one-time token", async () => {
    render(
      <SandboxProfileRuntimeSection
        apiKeys={[]}
        availableConnections={[]}
        availableTargets={[]}
        disabled={false}
        isDraft={true}
        onCreateApiKey={async (input) => ({
          apiKey: {
            ...MistleApiKey,
            name: input.name,
          },
          token: "mstl_apk_test",
        })}
        providers={[DockerProvider]}
        version={createVersion({
          sandboxProvider: "docker",
          sandboxConnectionId: null,
          sandboxResources: null,
        })}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Create new API key" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), {
      target: { value: "Sandbox agent key" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create API key" }));

    await waitFor(() => {
      expect(screen.getByText("API key created")).toBeTruthy();
    });
    expect(
      screen.getByText(
        "This key has been selected for Mistle resource access. Copy the token only if you also want to use Sandbox agent key outside this profile editor; it will not be shown again.",
      ),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy API key token" })).toBeTruthy();
  });

  it("renders saved Mistle resources in read-only mode", () => {
    render(
      <SandboxProfileRuntimeSection
        apiKeys={[MistleApiKey]}
        availableConnections={[]}
        availableTargets={[]}
        disabled={false}
        isDraft={false}
        providers={[DockerProvider]}
        version={createVersion({
          sandboxProvider: "docker",
          sandboxConnectionId: null,
          sandboxResources: null,
          mistleMcpEnabled: true,
          mistleMcpApiKeyId: MistleApiKey.id,
        })}
      />,
    );

    expect(screen.getByText("Mistle resources")).toBeTruthy();
    expect(screen.getByText("Mistle MCP key")).toBeTruthy();
  });

  it("renders unconfigured Mistle resources as None in read-only mode", () => {
    render(
      <SandboxProfileRuntimeSection
        apiKeys={[MistleApiKey]}
        availableConnections={[]}
        availableTargets={[]}
        disabled={false}
        isDraft={false}
        providers={[DockerProvider]}
        version={createVersion({
          sandboxProvider: "docker",
          sandboxConnectionId: null,
          sandboxResources: null,
        })}
      />,
    );

    expect(screen.getByText("Mistle resources")).toBeTruthy();
    expect(screen.getByText("None")).toBeTruthy();
  });

  it("renders managed Docker as Mistle without the Docker label", () => {
    render(
      <SandboxProfileRuntimeSection
        apiKeys={[]}
        availableConnections={[]}
        availableTargets={[]}
        disabled={false}
        isDraft={true}
        providers={[DockerProvider]}
        version={createVersion({
          sandboxProvider: "docker",
          sandboxConnectionId: null,
          sandboxResources: null,
        })}
      />,
    );

    expect(screen.getByRole("combobox", { name: "Sandbox provider" })).toBeTruthy();
    expect(screen.getAllByText("Mistle").length).toBeGreaterThan(0);
    expect(screen.queryByText("Docker")).toBeNull();
  });

  it("prompts for provider selection when no sandbox provider is configured", () => {
    render(
      <SandboxProfileRuntimeSection
        apiKeys={[]}
        availableConnections={[]}
        availableTargets={[]}
        disabled={false}
        isDraft={true}
        providers={[DockerProvider, OrganizationE2BProvider]}
        version={createVersion({
          sandboxProvider: null,
          sandboxConnectionId: null,
          sandboxResources: null,
        })}
      />,
    );

    expect(screen.getByRole("combobox", { name: "Sandbox provider" })).toBeTruthy();
    expect(screen.getByText("Select sandbox provider")).toBeTruthy();
    expect(screen.queryByText("Unknown provider")).toBeNull();
  });

  it("uses Tensorlake for the Mistle provider when multiple managed providers are configured", () => {
    expect(resolveManagedSandboxProvider([DockerProvider, E2BProvider, TensorlakeProvider])).toBe(
      TensorlakeProvider,
    );
  });

  it("builds the Mistle default runtime config from the managed provider defaults", () => {
    expect(
      createDefaultMistleSandboxRuntimeConfig([DockerProvider, E2BProvider, TensorlakeProvider]),
    ).toEqual({
      sandboxProvider: "tensorlake",
      sandboxResources: {
        vcpuCount: 1,
        memoryMb: 1024,
        diskMb: 10240,
      },
    });
  });

  it("marks the runtime dirty when switching from Mistle to BYOK for the same provider", async () => {
    let runtimeDraftState: SandboxProfileRuntimeDraftState | undefined;
    render(
      <MemoryRouter>
        <SandboxProfileRuntimeSection
          apiKeys={[]}
          availableConnections={[E2BRuntimeConnection]}
          availableTargets={[E2BRuntimeTarget]}
          disabled={false}
          isDraft={true}
          onDraftStateChange={(nextState) => {
            runtimeDraftState = nextState;
          }}
          providers={[E2BProvider]}
          version={createVersion({
            sandboxProvider: "e2b",
            sandboxConnectionId: null,
            sandboxResources: {
              vcpuCount: 4,
              memoryMb: 8192,
            },
          })}
        />
      </MemoryRouter>,
    );

    expect(runtimeDraftState?.hasUnpersistedChanges).toBe(false);

    fireEvent.click(screen.getByRole("combobox", { name: "Sandbox provider" }));
    const organizationProviderOption = screen.getByRole("option", { name: "E2B" });
    fireEvent.mouseMove(organizationProviderOption);
    fireEvent.mouseDown(organizationProviderOption, { button: 0 });
    fireEvent.mouseUp(organizationProviderOption, { button: 0 });
    fireEvent.click(organizationProviderOption, { button: 0 });

    await waitFor(() => {
      expect(runtimeDraftState?.hasUnpersistedChanges).toBe(true);
    });

    fireEvent.click(screen.getByRole("combobox", { name: "Connection" }));
    const connectionOption = screen.getByRole("option", { name: "E2B Production" });
    fireEvent.mouseMove(connectionOption);
    fireEvent.mouseDown(connectionOption, { button: 0 });
    fireEvent.mouseUp(connectionOption, { button: 0 });
    fireEvent.click(connectionOption, { button: 0 });

    await waitFor(() => {
      if (runtimeDraftState === undefined) {
        throw new Error("Expected runtime draft state to be available.");
      }

      if (runtimeDraftState.buildDraftChanges === undefined) {
        throw new Error("Expected runtime draft changes builder to be available.");
      }

      expect(runtimeDraftState.buildDraftChanges()).toEqual(
        expect.objectContaining({
          sandboxConnectionId: E2BRuntimeConnection.id,
          sandboxProvider: "e2b",
          sandboxResources: {
            vcpuCount: 4,
            memoryMb: 8192,
          },
        }),
      );
    });
  });

  it("renders saved read-only managed resources without normalizing to the preferred provider", () => {
    render(
      <SandboxProfileRuntimeSection
        apiKeys={[]}
        availableConnections={[]}
        availableTargets={[]}
        disabled={false}
        isDraft={false}
        providers={[E2BProvider, TensorlakeProvider]}
        version={createVersion({
          sandboxProvider: "e2b",
          sandboxConnectionId: null,
          sandboxResources: {
            vcpuCount: 2,
            memoryMb: 4096,
          },
        })}
      />,
    );

    expect(screen.getByText("Mistle")).toBeTruthy();
    expect(screen.getByText("2 vCPU")).toBeTruthy();
    expect(screen.getByText("4096 MB")).toBeTruthy();
    expect(screen.queryByText("Disk (MB)")).toBeNull();
  });

  it("renders saved read-only null-connection providers as Mistle when the catalog no longer marks the provider managed", () => {
    render(
      <SandboxProfileRuntimeSection
        apiKeys={[]}
        availableConnections={[]}
        availableTargets={[]}
        disabled={false}
        isDraft={false}
        providers={[OrganizationE2BProvider, TensorlakeProvider]}
        version={createVersion({
          sandboxProvider: "e2b",
          sandboxConnectionId: null,
          sandboxResources: {
            vcpuCount: 2,
            memoryMb: 4096,
          },
        })}
      />,
    );

    expect(screen.getByText("Mistle")).toBeTruthy();
    expect(screen.queryByText("Connection")).toBeNull();
    expect(screen.queryByText("Select connection")).toBeNull();
    expect(screen.queryByText("E2B")).toBeNull();
  });

  it("marks a saved sandbox provider as unavailable when it is no longer listed", () => {
    render(
      <SandboxProfileRuntimeSection
        apiKeys={[]}
        availableConnections={[]}
        availableTargets={[]}
        disabled={false}
        isDraft={true}
        providers={[DockerProvider]}
        version={createVersion({
          sandboxProvider: "e2b",
          sandboxConnectionId: null,
          sandboxResources: {
            vcpuCount: 2,
            memoryMb: 4096,
          },
        })}
      />,
    );

    expect(screen.getByText("Sandbox provider unavailable")).toBeTruthy();
    expect(screen.queryByText("Unknown provider")).toBeNull();
  });

  it("renders organization-owned E2B as BYOK credentials for the selected provider", () => {
    render(
      <SandboxProfileRuntimeSection
        apiKeys={[]}
        availableConnections={[E2BRuntimeConnection]}
        availableTargets={[E2BRuntimeTarget]}
        disabled={false}
        isDraft={true}
        providers={[E2BProvider]}
        version={createVersion({
          sandboxProvider: "e2b",
          sandboxConnectionId: E2BRuntimeConnection.id,
          sandboxResources: {
            vcpuCount: 2,
            memoryMb: 4096,
          },
        })}
      />,
    );

    expect(screen.getByRole("combobox", { name: "Connection" }).hasAttribute("disabled")).toBe(
      false,
    );
    expect(screen.getByText("E2B Production")).toBeTruthy();
    expect(screen.getByText("E2B")).toBeTruthy();
    expect(screen.queryByText("E2B (Managed)")).toBeNull();
  });

  it("renders read-only inline runtime settings with the same row labels as the draft view", () => {
    render(
      <SandboxProfileRuntimeSection
        apiKeys={[]}
        availableConnections={[E2BRuntimeConnection]}
        availableTargets={[E2BRuntimeTarget]}
        disabled={false}
        isDraft={false}
        providers={[DockerProvider, OrganizationStorageE2BProvider]}
        sectionChrome={false}
        version={createVersion({
          sandboxProvider: "e2b",
          sandboxConnectionId: E2BRuntimeConnection.id,
          sandboxResources: {
            vcpuCount: 4,
            memoryMb: 8192,
            diskMb: 20480,
          },
        })}
      />,
    );

    expect(screen.getByText("Agent")).toBeTruthy();
    expect(screen.getByText("Codex")).toBeTruthy();
    expect(screen.getByText("Sandbox provider")).toBeTruthy();
    expect(screen.queryByText("Provider")).toBeNull();
    expect(screen.queryByText("Credentials")).toBeNull();
    expect(screen.queryByText("Use workspace API key")).toBeNull();
    expect(screen.getByText("Connection")).toBeTruthy();
    expect(screen.getByText("E2B Production")).toBeTruthy();
    expect(screen.getByText("CPU")).toBeTruthy();
    expect(screen.getByText("4 vCPU")).toBeTruthy();
    expect(screen.getByText("Memory (MB)")).toBeTruthy();
    expect(screen.getByText("8192 MB")).toBeTruthy();
    expect(screen.getByText("Disk (MB)")).toBeTruthy();
    expect(screen.getByText("20480 MB")).toBeTruthy();
    expect(screen.queryByText("Resources")).toBeNull();
  });

  it("requires BYOK credentials after selecting a non-managed provider without a connection", () => {
    render(
      <MemoryRouter>
        <SandboxProfileRuntimeSection
          apiKeys={[]}
          availableConnections={[]}
          availableTargets={[
            {
              targetKey: "e2b-default",
              displayName: "E2B",
              familyId: "e2b",
              variantId: "e2b-default",
              config: {},
              targetHealth: {
                configStatus: "valid",
              },
            },
          ]}
          disabled={false}
          isDraft={true}
          providers={[DockerProvider, OrganizationE2BProvider]}
          version={createVersion({
            sandboxProvider: null,
            sandboxConnectionId: null,
            sandboxResources: null,
          })}
        />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("combobox", { name: "Sandbox provider" }));
    const organizationProviderOption = screen.getByRole("option", { name: "E2B" });
    fireEvent.mouseMove(organizationProviderOption);
    fireEvent.mouseDown(organizationProviderOption, { button: 0 });
    fireEvent.mouseUp(organizationProviderOption, { button: 0 });
    fireEvent.click(organizationProviderOption, { button: 0 });

    expect(screen.queryByRole("combobox", { name: "API key" })).toBeNull();
    expect(screen.getByRole("combobox", { name: "Connection" }).hasAttribute("disabled")).toBe(
      false,
    );
    expect(screen.getByText("Select connection")).toBeTruthy();
    expect(screen.getByText("Add an API key in integrations")).toBeTruthy();
    expect(screen.queryByText("Using Mistle's key")).toBeNull();
  });

  it("renders provider resource controls only for supported resource fields", () => {
    render(
      <SandboxProfileRuntimeSection
        apiKeys={[]}
        availableConnections={[]}
        availableTargets={[]}
        disabled={false}
        isDraft={true}
        providers={[E2BProvider]}
        version={createVersion({
          sandboxProvider: "e2b",
          sandboxConnectionId: null,
          sandboxResources: {
            vcpuCount: 2,
            memoryMb: 4096,
          },
        })}
      />,
    );

    expect(screen.getByLabelText("CPU")).toBeTruthy();
    expect(screen.getByLabelText("Memory (MB)")).toBeTruthy();
    expect(screen.getByText("2 vCPU")).toBeTruthy();
    expect(screen.getByText("4096 MB")).toBeTruthy();
    expect(screen.queryByLabelText("Disk (MB)")).toBeNull();
  });

  it("scales per-vCPU memory controls for providers with ratio-based memory limits", () => {
    render(
      <SandboxProfileRuntimeSection
        apiKeys={[]}
        availableConnections={[]}
        availableTargets={[]}
        disabled={false}
        isDraft={true}
        providers={[TensorlakeProvider]}
        version={createVersion({
          sandboxProvider: "tensorlake",
          sandboxConnectionId: null,
          sandboxResources: {
            vcpuCount: 4,
            memoryMb: 32768,
          },
        })}
      />,
    );

    expect(screen.getByLabelText("Memory (MB)")).toBeTruthy();
    expect(screen.getByLabelText("Disk (MB)")).toBeTruthy();
    expect(screen.getByText("32768 MB")).toBeTruthy();
  });

  it("renders disk when the selected provider advertises disk capabilities", () => {
    render(
      <SandboxProfileRuntimeSection
        apiKeys={[]}
        availableConnections={[]}
        availableTargets={[]}
        disabled={false}
        isDraft={true}
        providers={[OrganizationStorageE2BProvider]}
        version={createVersion({
          sandboxProvider: "e2b",
          sandboxConnectionId: null,
          sandboxResources: {
            vcpuCount: 4,
            memoryMb: 8192,
            diskMb: 20480,
          },
        })}
      />,
    );

    expect(screen.getByLabelText("CPU")).toBeTruthy();
    expect(screen.getByLabelText("Memory (MB)")).toBeTruthy();
    expect(screen.getByLabelText("Disk (MB)")).toBeTruthy();
  });
});
