export class SandboxError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "SandboxError";
  }
}

export class SandboxResourceNotFoundError extends SandboxError {
  readonly resourceType: string;
  readonly resourceId: string;

  constructor(input: { resourceType: string; resourceId: string; cause?: unknown }) {
    super(`${input.resourceType} '${input.resourceId}' was not found.`, { cause: input.cause });
    this.name = "SandboxResourceNotFoundError";
    this.resourceType = input.resourceType;
    this.resourceId = input.resourceId;
  }
}

export function isSandboxResourceNotFoundError(
  error: unknown,
): error is SandboxResourceNotFoundError {
  return error instanceof SandboxResourceNotFoundError;
}

export class SandboxConfigurationError extends SandboxError {
  constructor(message: string) {
    super(message);
    this.name = "SandboxConfigurationError";
  }
}

export class SandboxProviderNotImplementedError extends SandboxError {
  constructor(message: string) {
    super(message);
    this.name = "SandboxProviderNotImplementedError";
  }
}
