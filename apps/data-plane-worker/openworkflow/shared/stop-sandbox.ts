import type { SandboxAdapter, SandboxProvider, SandboxRuntimeControl } from "@mistle/sandbox";

export async function stopSandbox(
  ctx: {
    sandboxAdapter: SandboxAdapter;
    sandboxRuntimeControl: SandboxRuntimeControl;
  },
  input: {
    runtimeProvider: SandboxProvider;
    providerSandboxId: string;
  },
): Promise<void> {
  await ctx.sandboxRuntimeControl.shutdown({
    id: input.providerSandboxId,
  });
  await ctx.sandboxAdapter.stop({
    id: input.providerSandboxId,
  });
}
