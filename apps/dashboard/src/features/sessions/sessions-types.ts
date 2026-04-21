import type { paths } from "../../lib/control-plane-api/generated/schema.js";

type ListSandboxInstancesResponse =
  paths["/v1/sandbox/instances"]["get"]["responses"][200]["content"]["application/json"];

export type SandboxInstancesListResult = ListSandboxInstancesResponse;
export type SandboxInstanceListItem = SandboxInstancesListResult["items"][number];
export type SandboxInstancesNextPageCursor = NonNullable<SandboxInstancesListResult["nextPage"]>;
export type SandboxInstancesPreviousPageCursor = NonNullable<
  SandboxInstancesListResult["previousPage"]
>;
