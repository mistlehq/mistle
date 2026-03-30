import type { StartSandboxInstanceWorkflowInput } from "@mistle/workflow-registry/data-plane";

const Encoder = new TextEncoder();

export const SandboxStartupModes = {
  NEW: "new",
  EXISTING: "existing",
} as const;

export type SandboxStartupMode = (typeof SandboxStartupModes)[keyof typeof SandboxStartupModes];

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

export type SandboxStartupInput = {
  startupMode: SandboxStartupMode;
  bootstrapToken: string;
  tunnelExchangeToken: string;
  tunnelGatewayWsUrl: string;
  runtimePlan: StartSandboxInstanceWorkflowInput["runtimePlan"];
  egressGrantByRuleId: Record<string, string>;
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
