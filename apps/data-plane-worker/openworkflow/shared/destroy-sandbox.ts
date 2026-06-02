import type { SandboxAdapter, SandboxProvider } from "@mistle/sandbox";

export async function destroySandbox(
  ctx: {
    sandboxAdapter: SandboxAdapter;
  },
  input: {
    runtimeProvider: SandboxProvider;
    providerSandboxId: string;
  },
): Promise<void> {
  await ctx.sandboxAdapter.destroy({
    id: input.providerSandboxId,
  });
}
