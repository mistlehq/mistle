export const SandboxInstancesListQueryPrefix = ["sandbox-instances", "list"] as const;
export const SidebarSessionsQueryPrefix = ["sidebar-sessions"] as const;

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

export function sidebarSessionsQueryKey() {
  return SidebarSessionsQueryPrefix;
}

export function sandboxInstanceStatusQueryKey(sandboxInstanceId: string) {
  return ["sandbox-instance-status", sandboxInstanceId] as const;
}
