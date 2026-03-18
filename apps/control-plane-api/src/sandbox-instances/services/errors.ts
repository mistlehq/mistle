export const SandboxInstancesNotFoundCodes = {
  INSTANCE_NOT_FOUND: "INSTANCE_NOT_FOUND",
} as const;

export type SandboxInstancesNotFoundCode =
  (typeof SandboxInstancesNotFoundCodes)[keyof typeof SandboxInstancesNotFoundCodes];

export class SandboxInstancesNotFoundError extends Error {
  code: SandboxInstancesNotFoundCode;

  constructor(code: SandboxInstancesNotFoundCode, message: string) {
    super(message);
    this.name = "SandboxInstancesNotFoundError";
    this.code = code;
  }
}

export const SandboxInstancesBadRequestCodes = {
  INVALID_LIST_INSTANCES_INPUT: "INVALID_LIST_INSTANCES_INPUT",
} as const;

export type SandboxInstancesBadRequestCode =
  (typeof SandboxInstancesBadRequestCodes)[keyof typeof SandboxInstancesBadRequestCodes];

export class SandboxInstancesBadRequestError extends Error {
  code: SandboxInstancesBadRequestCode;

  constructor(code: SandboxInstancesBadRequestCode, message: string) {
    super(message);
    this.name = "SandboxInstancesBadRequestError";
    this.code = code;
  }
}

export const SandboxInstancesConflictCodes = {
  INSTANCE_NOT_RUNNING: "INSTANCE_NOT_RUNNING",
} as const;

export type SandboxInstancesConflictCode =
  (typeof SandboxInstancesConflictCodes)[keyof typeof SandboxInstancesConflictCodes];

export class SandboxInstancesConflictError extends Error {
  code: SandboxInstancesConflictCode;

  constructor(code: SandboxInstancesConflictCode, message: string) {
    super(message);
    this.name = "SandboxInstancesConflictError";
    this.code = code;
  }
}
