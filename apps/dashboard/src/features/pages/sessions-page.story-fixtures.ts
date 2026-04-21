import type { InfiniteData } from "@tanstack/react-query";
import { QueryClient } from "@tanstack/react-query";

import { seedAuthenticatedSession } from "../../test-support/auth-session.js";
import { organizationLogoQueryKey } from "../organizations/organization-logo-query.js";
import { launchableSandboxProfilesQueryKey } from "../sandbox-profiles/sandbox-profiles-query-keys.js";
import type {
  LaunchableSandboxProfile,
  LaunchableSandboxProfilesResult,
} from "../sandbox-profiles/sandbox-profiles-types.js";
import {
  SidebarSessionsQueryPrefix,
  sidebarSessionsQueryKey,
  sandboxInstanceStatusQueryKey,
  sandboxInstancesListQueryKey,
} from "../sessions/sessions-query-keys.js";
import type {
  SandboxInstanceListItem,
  SandboxInstancesListResult,
  SandboxInstancesNextPageCursor,
} from "../sessions/sessions-types.js";

type SidebarSessionsQueryState =
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
    keepaliveActive: false,
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

export function buildSidebarSessionsInfiniteDataFixture(
  pages: readonly SandboxInstancesListResult[],
): InfiniteData<SandboxInstancesListResult, SandboxInstancesNextPageCursor | null> {
  return {
    pages: [...pages],
    pageParams: pages.map((page, pageIndex) =>
      pageIndex === 0 ? null : (pages[pageIndex - 1]?.nextPage ?? null),
    ),
  };
}

export function createSessionsPageStoryQueryClient(input?: {
  launchableProfiles?: LaunchableSandboxProfilesResult["items"];
  sidebarSessionsPages?: SandboxInstancesListResult[];
  sandboxInstancesList?: SandboxInstancesListResult;
  sandboxInstanceStatus?: {
    id: string;
    title: string | null;
    status: "pending" | "starting" | "running" | "stopped" | "failed";
    connectable: boolean;
    runtimeContext?: {
      launchCwd: string | null;
      primaryRepositoryRoot: string | null;
    } | null;
    failureCode?: string | null;
    failureMessage?: string | null;
  };
  sidebarSessionsQueryState?: SidebarSessionsQueryState;
}): QueryClient {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        refetchOnMount: false,
        refetchOnReconnect: false,
        refetchOnWindowFocus: false,
        retry: false,
        staleTime: Number.POSITIVE_INFINITY,
      },
    },
  });
  queryClient.setQueryDefaults(SidebarSessionsQueryPrefix, {
    enabled: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
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
  const sidebarQueryKey = sidebarSessionsQueryKey();
  const sidebarSessionsQueryState = input?.sidebarSessionsQueryState ?? {
    kind: "success",
  };

  if (sidebarSessionsQueryState.kind === "success") {
    queryClient.setQueryData(
      sidebarQueryKey,
      buildSidebarSessionsInfiniteDataFixture(
        input?.sidebarSessionsPages ?? [
          {
            items: [],
            nextPage: null,
            previousPage: null,
            totalResults: 0,
          },
        ],
      ),
    );
  } else if (sidebarSessionsQueryState.kind === "pending") {
    const sidebarSessionsQuery = queryClient.getQueryCache().build(queryClient, {
      queryKey: sidebarQueryKey,
      queryFn: async () =>
        await new Promise<
          InfiniteData<SandboxInstancesListResult, SandboxInstancesNextPageCursor | null>
        >(() => undefined),
    });

    sidebarSessionsQuery.setState({
      ...sidebarSessionsQuery.state,
      data: undefined,
      error: null,
      fetchStatus: "fetching",
      status: "pending",
    });
  } else {
    const sidebarSessionsQuery = queryClient.getQueryCache().build(queryClient, {
      queryKey: sidebarQueryKey,
      queryFn: async () => {
        throw new Error(
          sidebarSessionsQueryState.errorMessage ?? "Could not load sandbox instances.",
        );
      },
    });

    sidebarSessionsQuery.setState({
      ...sidebarSessionsQuery.state,
      data: undefined,
      error: new Error(
        sidebarSessionsQueryState.errorMessage ?? "Could not load sandbox instances.",
      ),
      errorUpdateCount: 1,
      errorUpdatedAt: Date.now(),
      fetchStatus: "idle",
      status: "error",
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
      automationConversation: null,
    });
  }

  return queryClient;
}
