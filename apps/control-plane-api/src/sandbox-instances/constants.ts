export const SANDBOX_INSTANCES_ROUTE_BASE_PATH = "/v1/sandbox/instances";
export const SANDBOX_INSTANCE_CONNECTION_TOKEN_TTL_SECONDS = 120;
export const SANDBOX_INSTANCE_PORT_ACCESS_BOOTSTRAP_PATH = "/_mistle/access/bootstrap";
export const SANDBOX_INSTANCE_PORT_ACCESS_TOKEN_TTL_SECONDS = 120;

export const SandboxInstancesBadRequestCodes = {
  INVALID_LIST_INSTANCES_INPUT: "INVALID_LIST_INSTANCES_INPUT",
} as const;

export const SandboxInstancesNotFoundCodes = {
  INSTANCE_NOT_FOUND: "INSTANCE_NOT_FOUND",
} as const;

export const SandboxInstancesConflictCodes = {
  INSTANCE_NOT_RESUMABLE: "INSTANCE_NOT_RESUMABLE",
  INSTANCE_FAILED: "INSTANCE_FAILED",
  INSTANCE_STOP_NOT_SUPPORTED: "INSTANCE_STOP_NOT_SUPPORTED",
} as const;
