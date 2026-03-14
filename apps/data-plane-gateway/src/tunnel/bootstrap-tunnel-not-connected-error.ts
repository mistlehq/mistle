export class BootstrapTunnelNotConnectedError extends Error {
  public constructor(sandboxInstanceId: string) {
    super(`Sandbox bootstrap tunnel is not connected for sandbox '${sandboxInstanceId}'.`);
  }
}
