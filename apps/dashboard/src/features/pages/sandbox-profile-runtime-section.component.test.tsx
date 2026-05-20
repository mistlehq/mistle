// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";

import type {
  SandboxProviderSummary,
  SandboxProfileVersion,
} from "../sandbox-profiles/sandbox-profiles-types.js";
import type { ApiKey } from "../settings/api-keys/api-keys-service.js";
import { SandboxProfileRuntimeSection } from "./sandbox-profile-runtime-section.js";

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
      max: 8192,
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
    storageMb: {
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
  managed: true,
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
    storageMb: {
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
    agentRuntimeId: input.agentRuntimeId ?? "codex",
    mistleMcpEnabled: input.mistleMcpEnabled ?? false,
    mistleMcpApiKeyId: input.mistleMcpApiKeyId ?? null,
    defaultPersistenceMode: "ephemeral",
    sandboxProvider: input.sandboxProvider,
    sandboxConnectionId: input.sandboxConnectionId,
    maintenanceScript: null,
    sandboxResources: input.sandboxResources,
    isActive: false,
    usable: false,
    latestSnapshotJob: null,
    refreshSchedule: null,
  };
}

describe("SandboxProfileRuntimeSection", () => {
  it("renders managed E2B as a provider with default credentials selected", () => {
    render(
      <SandboxProfileRuntimeSection
        apiKeys={[]}
        availableConnections={[]}
        availableTargets={[]}
        disabled={false}
        isDraft={true}
        providers={[DockerProvider, E2BProvider]}
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

    expect(screen.getByText("Sandbox Runtime")).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Agent" })).toBeTruthy();
    expect(screen.getByText("Codex")).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Provider" })).toBeTruthy();
    expect(screen.getByText("E2B")).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Credentials" })).toBeTruthy();
    expect(screen.getByText("Managed by Mistle")).toBeTruthy();
    expect(screen.queryByRole("combobox", { name: "Connection" })).toBeNull();
    expect(screen.queryByText("E2B (Managed)")).toBeNull();
    expect(screen.queryByText("Managed")).toBeNull();
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

  it("renders Mistle resource access controls in the Agent section", () => {
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

    const toggle = screen.getByRole("switch", {
      name: "Allow agent to interact with Mistle resources",
    });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(
      screen.queryByText("Expose Mistle profile tools to the sandbox agent through MCP."),
    ).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Mistle API key" })).toBeNull();

    fireEvent.click(toggle);

    expect(toggle.getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("combobox", { name: "Mistle API key" })).toBeTruthy();
  });

  it("disables Mistle API key selection when no API keys exist", () => {
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

    fireEvent.click(
      screen.getByRole("switch", {
        name: "Allow agent to interact with Mistle resources",
      }),
    );

    expect(screen.getByRole("combobox", { name: "Mistle API key" }).hasAttribute("disabled")).toBe(
      true,
    );
    expect(screen.getByRole("button", { name: "Create new API key" })).toBeTruthy();
  });

  it("shows permissions for the selected Mistle API key", () => {
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

    expect(screen.getByText("Permissions")).toBeTruthy();
    expect(screen.getByText("sandboxProfile:read")).toBeTruthy();
  });

  it("opens API key creation in a dialog", () => {
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
    expect(screen.getByText("Read sandbox profiles")).toBeTruthy();
  });

  it("renders saved Mistle resource access in read-only mode", () => {
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

    expect(screen.getByText("Allow agent to interact with Mistle resources")).toBeTruthy();
    expect(screen.getByText("Yes")).toBeTruthy();
    expect(screen.getByText("Mistle API key")).toBeTruthy();
    expect(screen.getByText("Mistle MCP key")).toBeTruthy();
  });

  it("renders the Docker provider with the Docker logo", () => {
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

    const providerLogo = screen
      .getByRole("combobox", { name: "Provider" })
      .querySelector('img[src="/integration-logos/docker.svg"]');
    expect(providerLogo).not.toBeNull();
    expect(screen.getByText("Docker")).toBeTruthy();
  });

  it("prompts for provider selection when no sandbox provider is configured", () => {
    render(
      <SandboxProfileRuntimeSection
        apiKeys={[]}
        availableConnections={[]}
        availableTargets={[]}
        disabled={false}
        isDraft={true}
        providers={[DockerProvider, E2BProvider]}
        version={createVersion({
          sandboxProvider: null,
          sandboxConnectionId: null,
          sandboxResources: null,
        })}
      />,
    );

    expect(screen.getByRole("combobox", { name: "Provider" })).toBeTruthy();
    expect(screen.getByText("Select provider")).toBeTruthy();
    expect(screen.queryByText("Unknown provider")).toBeNull();
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

    expect(screen.getByText("Provider unavailable")).toBeTruthy();
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
        providers={[DockerProvider, E2BProvider]}
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

    expect(screen.getByText("Use workspace API key")).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Connection" }).hasAttribute("disabled")).toBe(
      false,
    );
    expect(screen.getByText("E2B Production")).toBeTruthy();
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
            storageMb: 20480,
          },
        })}
      />,
    );

    expect(screen.getByText("Agent")).toBeTruthy();
    expect(screen.getByText("Codex")).toBeTruthy();
    expect(screen.getByText("Sandbox Runtime")).toBeTruthy();
    expect(screen.queryByText("Provider")).toBeNull();
    expect(screen.getByText("Credentials")).toBeTruthy();
    expect(screen.getByText("Use workspace API key")).toBeTruthy();
    expect(screen.getByText("Connection")).toBeTruthy();
    expect(screen.getByText("E2B Production")).toBeTruthy();
    expect(screen.getByText("CPU")).toBeTruthy();
    expect(screen.getByText("4 vCPU")).toBeTruthy();
    expect(screen.getByText("Memory (MB)")).toBeTruthy();
    expect(screen.getByText("8192 MB")).toBeTruthy();
    expect(screen.getByText("Storage (MB)")).toBeTruthy();
    expect(screen.getByText("20480 MB")).toBeTruthy();
    expect(screen.queryByText("Resources")).toBeNull();
  });

  it("requires BYOK credentials for a non-managed provider without a saved connection", () => {
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
            sandboxProvider: "e2b",
            sandboxConnectionId: null,
            sandboxResources: {
              vcpuCount: 2,
              memoryMb: 4096,
            },
          })}
        />
      </MemoryRouter>,
    );

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
    expect(screen.queryByLabelText("Storage (MB)")).toBeNull();
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
    expect(screen.getByLabelText("Storage (MB)")).toBeTruthy();
    expect(screen.getByText("32768 MB")).toBeTruthy();
  });

  it("renders storage when the selected provider advertises storage capabilities", () => {
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
            storageMb: 20480,
          },
        })}
      />,
    );

    expect(screen.getByLabelText("CPU")).toBeTruthy();
    expect(screen.getByLabelText("Memory (MB)")).toBeTruthy();
    expect(screen.getByLabelText("Storage (MB)")).toBeTruthy();
  });
});
