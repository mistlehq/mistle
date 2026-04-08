import { QueryClient } from "@tanstack/react-query";

import {
  createAuthenticatedSessionFixture,
  seedAuthenticatedSession,
} from "../../test-support/auth-session.js";
import { launchableSandboxProfilesQueryKey } from "../sandbox-profiles/sandbox-profiles-query-keys.js";
import type {
  LaunchableSandboxProfile,
  LaunchableSandboxProfilesResult,
} from "../sandbox-profiles/sandbox-profiles-types.js";
import { sandboxInstancesListQueryKey } from "../sessions/sessions-query-keys.js";
import type {
  SandboxInstanceListItem,
  SandboxInstancesListResult,
} from "../sessions/sessions-types.js";

export function buildStoryLaunchableSandboxProfile(
  overrides: Partial<LaunchableSandboxProfile> & Pick<LaunchableSandboxProfile, "id">,
): LaunchableSandboxProfile {
  const { id, ...restOverrides } = overrides;

  return {
    id,
    displayName: "Alpha Profile",
    status: "active",
    latestVersion: 3,
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

export function createSessionsPageStoryQueryClient(input?: {
  launchableProfiles?: LaunchableSandboxProfilesResult["items"];
  sandboxInstancesList?: SandboxInstancesListResult;
}): QueryClient {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: Number.POSITIVE_INFINITY,
      },
    },
  });

  seedAuthenticatedSession(queryClient);
  queryClient.setQueryData(launchableSandboxProfilesQueryKey(), {
    items: input?.launchableProfiles ?? [
      buildStoryLaunchableSandboxProfile({ id: "sbp_profile_alpha" }),
    ],
  } satisfies LaunchableSandboxProfilesResult);
  queryClient.setQueryData(
    sandboxInstancesListQueryKey({
      limit: 20,
      after: null,
      before: null,
    }),
    input?.sandboxInstancesList ?? {
      items: [],
      nextPage: null,
      previousPage: null,
      totalResults: 0,
    },
  );

  return queryClient;
}

export const StoryAuthenticatedSession = createAuthenticatedSessionFixture();
