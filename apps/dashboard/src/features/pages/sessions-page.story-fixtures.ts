import { QueryClient } from "@tanstack/react-query";

import { seedAuthenticatedSession } from "../../test-support/auth-session.js";
import { organizationLogoQueryKey } from "../organizations/organization-logo-query.js";
import { launchableSandboxProfilesQueryKey } from "../sandbox-profiles/sandbox-profiles-query-keys.js";
import type {
  LaunchableSandboxProfile,
  LaunchableSandboxProfilesResult,
} from "../sandbox-profiles/sandbox-profiles-types.js";
import {
  sandboxInstanceStatusQueryKey,
  sandboxInstancesListQueryKey,
} from "../sessions/sessions-query-keys.js";
import type {
  SandboxInstanceListItem,
  SandboxInstancesListResult,
} from "../sessions/sessions-types.js";

type SessionsSidebarQueryState =
  | {
      kind: "success";
    }
  | {
      kind: "pending";
    }
  | {
      errorMessage?: string;
      kind: "error";
    };

function storyOrganizationSummaryQueryKey(
  organizationId: string | null,
): readonly ["shell", "organization-summary", string | null] {
  return ["shell", "organization-summary", organizationId];
}

export function buildStoryLaunchableSandboxProfile(
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

export function createSessionsPageStoryQueryClient(input?: {
  launchableProfiles?: LaunchableSandboxProfilesResult["items"];
  sandboxInstancesList?: SandboxInstancesListResult;
  sandboxInstanceStatus?: {
    id: string;
    title: string | null;
    status: "pending" | "starting" | "running" | "stopped" | "failed";
    connectable: boolean;
    runtimeContext?: {
      agentRuntimeId: "codex" | "opencode" | null;
      launchCwd: string | null;
      primaryRepositoryRoot: string | null;
    } | null;
    failureCode?: string | null;
    failureMessage?: string | null;
    startupOperation?: {
      operationId: string;
      operationKind: "start" | "resume";
    } | null;
  };
  sessionsSidebarQueryState?: SessionsSidebarQueryState;
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
  queryClient.setQueryData(storyOrganizationSummaryQueryKey("org_123"), {
    name: "Mistle Labs",
  });
  queryClient.setQueryData(organizationLogoQueryKey("org_123"), null);
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
  const sessionsSidebarQueryKey = sandboxInstancesListQueryKey({
    limit: 100,
    after: null,
    before: null,
  });
  const sessionsSidebarQueryState = input?.sessionsSidebarQueryState ?? {
    kind: "success",
  };

  if (sessionsSidebarQueryState.kind === "success") {
    queryClient.setQueryData(
      sessionsSidebarQueryKey,
      input?.sandboxInstancesList ?? {
        items: [],
        nextPage: null,
        previousPage: null,
        totalResults: 0,
      },
    );
  } else if (sessionsSidebarQueryState.kind === "pending") {
    queryClient.setQueryDefaults(sessionsSidebarQueryKey, {
      queryFn: async () => await new Promise<SandboxInstancesListResult>(() => undefined),
    });
  } else {
    queryClient.setQueryDefaults(sessionsSidebarQueryKey, {
      queryFn: async () => {
        throw new Error(
          sessionsSidebarQueryState.errorMessage ?? "Could not load sandbox instances.",
        );
      },
    });
  }

  if (input?.sandboxInstanceStatus !== undefined) {
    queryClient.setQueryData(sandboxInstanceStatusQueryKey(input.sandboxInstanceStatus.id), {
      id: input.sandboxInstanceStatus.id,
      title: input.sandboxInstanceStatus.title,
      status: input.sandboxInstanceStatus.status,
      connectable: input.sandboxInstanceStatus.connectable,
      failureCode: input.sandboxInstanceStatus.failureCode ?? null,
      failureMessage: input.sandboxInstanceStatus.failureMessage ?? null,
      runtimeContext: input.sandboxInstanceStatus.runtimeContext ?? null,
      triggerConversation: null,
      startupOperation: input.sandboxInstanceStatus.startupOperation ?? null,
    });
  }

  return queryClient;
}
