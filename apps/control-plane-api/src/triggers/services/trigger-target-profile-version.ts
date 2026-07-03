const InitialTriggerTargetSandboxProfileVersion = 1;

export function resolveTriggerTargetSandboxProfileVersion(input: {
  requestedVersion?: number | undefined;
  activeVersion: number | null;
}): number {
  return input.requestedVersion ?? input.activeVersion ?? InitialTriggerTargetSandboxProfileVersion;
}
