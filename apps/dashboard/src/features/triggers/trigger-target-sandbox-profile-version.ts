import type { SandboxProfileVersion } from "../sandbox-profiles/sandbox-profiles-types.js";

const InitialTriggerTargetSandboxProfileVersion = 1;

export function resolveTriggerTargetSandboxProfileVersion(
  versions: readonly SandboxProfileVersion[],
): number | null {
  const activeVersion = versions.find((version) => version.isActive);
  if (activeVersion !== undefined) {
    return activeVersion.version;
  }

  return (
    versions.find((version) => version.version === InitialTriggerTargetSandboxProfileVersion)
      ?.version ?? null
  );
}
