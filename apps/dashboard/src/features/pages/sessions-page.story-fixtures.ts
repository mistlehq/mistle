import { QueryClient } from "@tanstack/react-query";

import { seedAuthenticatedSession } from "../../test-support/auth-session.js";
import {
  buildLaunchableSandboxProfileFixture,
  type SessionsPageListFilters,
} from "../../test-support/sessions-page-fixtures.js";
import { organizationLogoQueryKey } from "../organizations/organization-logo-query.js";
import { launchableSandboxProfilesQueryKey } from "../sandbox-profiles/sandbox-profiles-query-keys.js";
import type { LaunchableSandboxProfilesResult } from "../sandbox-profiles/sandbox-profiles-types.js";
import {
  sandboxInstanceStatusQueryKey,
  sandboxInstancesListQueryKey,
} from "../sessions/sessions-query-keys.js";
import type { SandboxInstancesListResult } from "../sessions/sessions-types.js";
import { triggersListQueryKey } from "../triggers/triggers-query-keys.js";
import type { TriggerListItem, TriggersListResult } from "../triggers/triggers-types.js";

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

export function createSessionsPageStoryQueryClient(input?: {
  launchableProfiles?: LaunchableSandboxProfilesResult["items"];
  sandboxInstancesList?: SandboxInstancesListResult;
  sandboxInstancesListFilters?: SessionsPageListFilters;
  sandboxInstanceStatus?: {
    id: string;
    title: string | null;
    status: SandboxInstanceStatus;
    connectable: boolean;
    runtimeContext?: {
      agentRuntimeId: "claude-code" | "codex" | "opencode" | "pi" | null;
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
  triggerOptions?: TriggerListItem[];
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
      buildLaunchableSandboxProfileFixture({ id: "sbp_profile_alpha" }),
    ],
  } satisfies LaunchableSandboxProfilesResult);
  queryClient.setQueryData(
    sandboxInstancesListQueryKey({
      limit: 20,
      after: null,
      before: null,
      search: input?.sandboxInstancesListFilters?.search ?? "",
      owner: input?.sandboxInstancesListFilters?.owner ?? "anyone",
      startedFrom: input?.sandboxInstancesListFilters?.startedFrom ?? "any",
      triggerId: input?.sandboxInstancesListFilters?.triggerId ?? null,
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
    search: "",
    owner: "anyone",
    startedFrom: "any",
    triggerId: null,
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

  queryClient.setQueryData(
    triggersListQueryKey({
      limit: 100,
      after: null,
      before: null,
    }),
    {
      items: input?.triggerOptions ?? [],
      nextPage: null,
      previousPage: null,
      totalResults: input?.triggerOptions?.length ?? 0,
    } satisfies TriggersListResult,
  );

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
import type { SandboxInstanceStatus } from "@mistle/sandbox-lifecycle";
