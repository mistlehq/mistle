export function sandboxInstancesListQueryKey(input: {
  limit: number;
  after: string | null;
  before: string | null;
}) {
  return [
    "sandbox-instances",
    "list",
    {
      limit: input.limit,
      after: input.after,
      before: input.before,
    },
  ] as const;
}

export function sandboxInstanceStatusQueryKey(sandboxInstanceId: string) {
  return ["sandbox-instance-status", sandboxInstanceId] as const;
}
