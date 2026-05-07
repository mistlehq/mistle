import {
  SandboxdExecutionModes,
  type SandboxdStartupInput,
  type SandboxdTransparentProxyConfiguration,
} from "@mistle/sandbox-runtime-contract";
import type { StartSandboxInstanceWorkflowInput } from "@mistle/workflow-registry/data-plane";

const Encoder = new TextEncoder();

export const SandboxStartupModes = {
  NEW: "new",
  EXISTING: "existing",
} as const;

export type SandboxStartupMode = (typeof SandboxStartupModes)[keyof typeof SandboxStartupModes];

export const SandboxExecutionModes = {
  SESSION: SandboxdExecutionModes.SESSION,
  SNAPSHOT: SandboxdExecutionModes.SNAPSHOT,
} as const;

export type SandboxExecutionMode =
  (typeof SandboxExecutionModes)[keyof typeof SandboxExecutionModes];

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

export type SandboxStartupInput = {
  startupMode: SandboxStartupMode;
  executionMode?: SandboxExecutionMode;
  bootstrapToken: string;
  tunnelExchangeToken: string;
  tunnelGatewayWsUrl: string;
  runtimePlan: StartSandboxInstanceWorkflowInput["runtimePlan"];
  actingUserId?: StartSandboxInstanceWorkflowInput["actingUserId"];
  egressGrantByRuleId: Record<string, string>;
  gitIdentity?: SandboxdStartupInput["gitIdentity"];
  transparentProxy?: SandboxdTransparentProxyConfiguration;
};

export function createSandboxTunnelGatewayWsUrl(input: {
  gatewayWebsocketUrl: string;
  sandboxInstanceId: string;
}): string {
  const gatewayUrl = new URL(input.gatewayWebsocketUrl);
  gatewayUrl.pathname = `${trimTrailingSlash(gatewayUrl.pathname)}/${encodeURIComponent(input.sandboxInstanceId)}`;

  return gatewayUrl.toString();
}

export function encodeSandboxStartupInput(input: SandboxStartupInput): Uint8Array {
  return Encoder.encode(`${JSON.stringify(input)}\n`);
}
