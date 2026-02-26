export class SandboxError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "SandboxError";
  }
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
