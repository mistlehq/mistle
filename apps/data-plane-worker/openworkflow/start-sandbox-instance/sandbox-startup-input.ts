import type { StartSandboxInstanceWorkflowInput } from "@mistle/workflow-registry/data-plane";

const Encoder = new TextEncoder();

export type SandboxStartupInstanceVolumeMode = "native" | "staged";
export type SandboxStartupInstanceVolumeState = "new" | "existing";

export const SandboxStartupInstanceVolumeModes = {
  NATIVE: "native",
  STAGED: "staged",
} satisfies Record<string, SandboxStartupInstanceVolumeMode>;

export const SandboxStartupInstanceVolumeStates = {
  NEW: "new",
  EXISTING: "existing",
} satisfies Record<string, SandboxStartupInstanceVolumeState>;

export type SandboxStartupInstanceVolume = {
  mode: SandboxStartupInstanceVolumeMode;
  state: SandboxStartupInstanceVolumeState;
};

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

export type SandboxStartupInput = {
  bootstrapToken: string;
  tunnelExchangeToken: string;
  tunnelGatewayWsUrl: string;
  instanceVolume: SandboxStartupInstanceVolume;
  runtimePlan: StartSandboxInstanceWorkflowInput["runtimePlan"];
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
