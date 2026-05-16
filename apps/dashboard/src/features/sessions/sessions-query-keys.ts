export function sandboxInstancesListQueryKey(input: {
  limit: number;
  after: string | null;
  before: string | null;
  search: string;
  owner: "anyone" | "me";
  startedFrom: "any" | "manual" | "trigger" | "event" | "schedule";
  triggerId: string | null;
}) {
  return [
    "sandbox-instances",
    "list",
    {
      limit: input.limit,
      after: input.after,
      before: input.before,
      search: input.search,
      owner: input.owner,
      startedFrom: input.startedFrom,
      triggerId: input.triggerId,
    },
  ] as const;
}

export function sandboxInstanceStatusQueryKey(sandboxInstanceId: string) {
  return ["sandbox-instance-status", sandboxInstanceId] as const;
}

export function sandboxOperationEventsQueryKey(input: {
  afterSequence: number | null;
  operationId: string;
  sandboxInstanceId: string;
}) {
  return [
    "sandbox-operation-events",
    input.sandboxInstanceId,
    input.operationId,
    input.afterSequence,
  ] as const;
}
