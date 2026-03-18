import {
  SandboxInstanceVolumeModes,
  type SandboxInstanceVolumeMode,
  type SandboxInstanceVolumeProvider,
} from "@mistle/db/data-plane";
import type { SandboxAdapter, SandboxProvider, SandboxVolumeHandleV1 } from "@mistle/sandbox";

export type ProvisionedInstanceVolume = {
  handle: SandboxVolumeHandleV1;
  instanceVolumeProvider: SandboxInstanceVolumeProvider;
  instanceVolumeId: string;
  instanceVolumeMode: SandboxInstanceVolumeMode;
};

export async function provisionInstanceVolume(ctx: {
  runtimeProvider: SandboxProvider;
  sandboxAdapter: SandboxAdapter;
}): Promise<ProvisionedInstanceVolume> {
  const volume = await ctx.sandboxAdapter.createVolume({});

  if (volume.provider !== ctx.runtimeProvider) {
    throw new Error("Sandbox adapter returned volume handle with unexpected provider.");
  }

  return {
    handle: volume,
    instanceVolumeProvider: volume.provider,
    instanceVolumeId: volume.volumeId,
    instanceVolumeMode: SandboxInstanceVolumeModes.NATIVE,
  };
}
