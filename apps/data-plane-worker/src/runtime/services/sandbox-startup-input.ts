import type { StartSandboxInstanceWorkflowInput } from "@mistle/workflows/data-plane";

const Encoder = new TextEncoder();

export type SandboxStartupInput = {
  bootstrapToken: string;
  tunnelGatewayWsUrl: string;
  runtimePlan: StartSandboxInstanceWorkflowInput["runtimePlan"];
};

export function encodeSandboxStartupInput(input: SandboxStartupInput): Uint8Array {
  return Encoder.encode(`${JSON.stringify(input)}\n`);
}
