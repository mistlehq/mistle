import type { LaunchableSandboxProfile } from "../sandbox-profiles/sandbox-profiles-types.js";
import type { SandboxInstanceListItem } from "../sessions/sessions-types.js";
import type { TriggerListItem } from "../triggers/triggers-types.js";

export type SessionsPageListFilters = {
  search: string;
  owner: "anyone" | "me";
  startedFrom: "any" | "manual" | "trigger" | "event" | "schedule";
  triggerId: string | null;
};

export function buildLaunchableSandboxProfileFixture(
  overrides: Partial<LaunchableSandboxProfile> & Pick<LaunchableSandboxProfile, "id">,
): LaunchableSandboxProfile {
  const { id, ...restOverrides } = overrides;

  return {
    id,
    activeVersion: 3,
    displayName: "Alpha Profile",
    status: "active",
    latestVersion: 3,
    repositoryOptions: [],
    createdAt: "2026-03-10T00:00:00.000Z",
    updatedAt: "2026-03-10T00:00:00.000Z",
    organizationId: "org_123",
    ...restOverrides,
  };
}

export function buildSandboxInstanceListItemFixture(
  overrides: Partial<SandboxInstanceListItem> & Pick<SandboxInstanceListItem, "id">,
): SandboxInstanceListItem {
  const { id, ...restOverrides } = overrides;

  return {
    id,
    title: null,
    sandboxProfileId: "sbp_profile_alpha",
    sandboxProfileDisplayName: "Alpha Profile",
    sandboxProfileVersion: 3,
    status: "running",
    startedBy: {
      kind: "user",
      id: "user-id",
      name: "Mistle User",
    },
    source: "dashboard",
    createdAt: "2026-03-10T00:00:00.000Z",
    updatedAt: "2026-03-10T00:00:00.000Z",
    failureCode: null,
    failureMessage: null,
    ...restOverrides,
  };
}

export function buildTriggerListItemFixture(
  overrides: Partial<TriggerListItem> & Pick<TriggerListItem, "id" | "name">,
): TriggerListItem {
  const { id, name, ...restOverrides } = overrides;

  return {
    id,
    kind: "webhook",
    name,
    enabled: true,
    target: {
      sandboxProfileId: "sbp_profile_alpha",
      sandboxProfileName: "Alpha Profile",
      sandboxProfileVersion: 3,
      primaryRepositoryId: null,
      primaryRepositoryName: null,
    },
    source: {
      kind: "webhook",
      events: [{ label: "app_mention" }],
    },
    updatedAt: "2026-03-10T00:00:00.000Z",
    ...restOverrides,
  };
}
