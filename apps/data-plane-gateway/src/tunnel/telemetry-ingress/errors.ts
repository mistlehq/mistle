export class SandboxTelemetryResetError extends Error {
  public readonly code: string;

  public constructor(input: { code: string; message: string }) {
    super(input.message);
    this.code = input.code;
    this.name = "SandboxTelemetryResetError";
  }
}
