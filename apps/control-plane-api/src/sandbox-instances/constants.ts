export const SANDBOX_INSTANCES_ROUTE_BASE_PATH = "/v1/sandbox/instances";
export const SANDBOX_INSTANCE_CONNECTION_TOKEN_TTL_SECONDS = 120;
export const SANDBOX_INSTANCE_PORT_PUBLISH_TOKEN_TTL_SECONDS = 300;
export const SANDBOX_INSTANCE_PORT_SHARE_DEFAULT_TTL_SECONDS = 3600;

export const SandboxInstancesBadRequestCodes = {
  INVALID_LIST_INSTANCES_INPUT: "INVALID_LIST_INSTANCES_INPUT",
} as const;

export const SandboxInstancesNotFoundCodes = {
  INSTANCE_NOT_FOUND: "INSTANCE_NOT_FOUND",
} as const;

export const SandboxInstancesConflictCodes = {
  INSTANCE_NOT_RESUMABLE: "INSTANCE_NOT_RESUMABLE",
  INSTANCE_FAILED: "INSTANCE_FAILED",
} as const;
