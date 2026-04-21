export const SandboxInstancesListQueryPrefix = ["sandbox-instances", "list"] as const;
export const SessionSidebarGroupsQueryPrefix = ["session-sidebar-groups"] as const;

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

export function sessionSidebarGroupsQueryKey(input: { limit: number }) {
  return [
    ...SessionSidebarGroupsQueryPrefix,
    {
      limit: input.limit,
    },
  ] as const;
}

export function sandboxInstanceStatusQueryKey(sandboxInstanceId: string) {
  return ["sandbox-instance-status", sandboxInstanceId] as const;
}
