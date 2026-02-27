const Encoder = new TextEncoder();

export type SandboxStartupInput = {
  bootstrapToken: string;
  tunnelGatewayWsUrl: string;
};

export function encodeSandboxStartupInput(input: SandboxStartupInput): Uint8Array {
  return Encoder.encode(`${JSON.stringify(input)}\n`);
}
