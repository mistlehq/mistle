import {
  type SandboxdActivationInput as SandboxdRuntimeActivationInput,
  type SandboxdOperationKind,
  type SandboxdTransparentProxyConfiguration,
} from "@mistle/sandbox-runtime-contract";
import type { StartSandboxInstanceWorkflowInput } from "@mistle/workflow-registry/data-plane";

const Encoder = new TextEncoder();

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

export type SandboxActivationOperationKind = SandboxdOperationKind;

export type SandboxActivationInput = {
  operationKind: SandboxActivationOperationKind;
  bootstrapToken: string;
  tunnelExchangeToken: string;
  tunnelGatewayWsUrl: string;
  runtimePlan: StartSandboxInstanceWorkflowInput["runtimePlan"];
  actingUserId?: StartSandboxInstanceWorkflowInput["actingUserId"];
  gitIdentity?: SandboxdRuntimeActivationInput["gitIdentity"];
  transparentProxy?: SandboxdTransparentProxyConfiguration;
};

export function createSandboxTunnelGatewayWsUrl(input: {
  gatewayWebsocketUrl: string;
  operationId?: string;
  sandboxInstanceId: string;
}): string {
  const gatewayUrl = new URL(input.gatewayWebsocketUrl);
  gatewayUrl.pathname = `${trimTrailingSlash(gatewayUrl.pathname)}/${encodeURIComponent(input.sandboxInstanceId)}`;
  if (input.operationId !== undefined) {
    gatewayUrl.searchParams.set("operation_id", input.operationId);
  }

  return gatewayUrl.toString();
}

export function encodeSandboxActivationInput(input: SandboxActivationInput): Uint8Array {
  return Encoder.encode(`${JSON.stringify(input)}\n`);
}
