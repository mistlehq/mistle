export const SandboxInstancesListQueryPrefix = ["sandbox-instances", "list"] as const;
export const SidebarSessionsQueryPrefix = ["sidebar-sessions"] as const;
export const SidebarSessionsFeedQueryPrefix = [...SidebarSessionsQueryPrefix, "feed"] as const;
export const SidebarSessionsHeadQueryPrefix = [...SidebarSessionsQueryPrefix, "head"] as const;

export function sandboxInstancesListQueryKey(input: {
  limit: number;
  after: string | null;
  before: string | null;
}) {
  return [
    ...SandboxInstancesListQueryPrefix,
    {
      limit: input.limit,
      after: input.after,
      before: input.before,
    },
  ] as const;
}

export function sidebarSessionsFeedQueryKey(input: { epoch: number }) {
  return [...SidebarSessionsFeedQueryPrefix, input.epoch] as const;
}

export function sidebarSessionsHeadQueryKey(input: { epoch: number }) {
  return [...SidebarSessionsHeadQueryPrefix, input.epoch] as const;
}

export function sandboxInstanceStatusQueryKey(sandboxInstanceId: string) {
  return ["sandbox-instance-status", sandboxInstanceId] as const;
}
