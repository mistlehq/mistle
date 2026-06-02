import type { SandboxAdapter, SandboxProvider } from "@mistle/sandbox";

export async function stopSandbox(
  ctx: {
    sandboxAdapter: SandboxAdapter;
  },
  input: {
    runtimeProvider: SandboxProvider;
    providerSandboxId: string;
  },
): Promise<void> {
  await ctx.sandboxAdapter.stop({
    id: input.providerSandboxId,
  });
}
