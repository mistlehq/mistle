// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type {
  SandboxProviderSummary,
  SandboxProfileVersion,
} from "../sandbox-profiles/sandbox-profiles-types.js";
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

const StorageProvider = {
  id: "e2b",
  displayName: "E2B",
  managed: true,
  supportsOrganizationConnection: false,
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

function createVersion(
  input: Pick<
    SandboxProfileVersion,
    "sandboxProvider" | "sandboxConnectionId" | "sandboxResources"
  >,
): SandboxProfileVersion {
  return {
    sandboxProfileId: "sbp_runtime_section_test",
    version: 1,
    state: "draft",
    defaultPersistenceMode: "ephemeral",
    sandboxProvider: input.sandboxProvider,
    sandboxConnectionId: input.sandboxConnectionId,
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

    expect(screen.getByText("Sandbox settings")).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Provider" })).toBeTruthy();
    expect(screen.getByText("E2B")).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "API key" })).toBeTruthy();
    expect(screen.getByText("Use Mistle's key")).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Connection" }).hasAttribute("disabled")).toBe(
      true,
    );
    expect(screen.getByText("Using Mistle's key")).toBeTruthy();
    expect(screen.queryByText("E2B (Managed)")).toBeNull();
    expect(screen.queryByText("Managed")).toBeNull();
  });

  it("renders organization-owned E2B as BYOK credentials for the selected provider", () => {
    render(
      <SandboxProfileRuntimeSection
        availableConnections={[
          {
            id: "icn_e2b_runtime_test",
            displayName: "E2B Production",
            targetKey: "e2b-default",
            status: "active",
            config: {},
          },
        ]}
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
        providers={[DockerProvider, E2BProvider]}
        version={createVersion({
          sandboxProvider: "e2b",
          sandboxConnectionId: "icn_e2b_runtime_test",
          sandboxResources: {
            vcpuCount: 2,
            memoryMb: 4096,
          },
        })}
      />,
    );

    expect(screen.getByText("Use my API key")).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Connection" }).hasAttribute("disabled")).toBe(
      false,
    );
    expect(screen.getByText("E2B Production")).toBeTruthy();
    expect(screen.queryByText("E2B (Managed)")).toBeNull();
  });

  it("renders provider resource controls only for supported resource fields", () => {
    render(
      <SandboxProfileRuntimeSection
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

  it("renders storage when the selected provider advertises storage capabilities", () => {
    render(
      <SandboxProfileRuntimeSection
        availableConnections={[]}
        availableTargets={[]}
        disabled={false}
        isDraft={true}
        providers={[StorageProvider]}
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
