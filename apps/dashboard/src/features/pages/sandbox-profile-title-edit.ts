export type ProfileNameCommitDecision =
  | {
      action: "revert";
    }
  | {
      action: "noop";
      displayName: string;
    }
  | {
      action: "save";
      displayName: string;
    };

export function resolveProfileNameCommitDecision(input: {
  draftDisplayName: string;
  persistedDisplayName: string;
}): ProfileNameCommitDecision {
  const normalizedDisplayName = input.draftDisplayName.trim();
  if (normalizedDisplayName.length === 0) {
    return {
      action: "revert",
    };
  }
  if (normalizedDisplayName === input.persistedDisplayName.trim()) {
    return {
      action: "noop",
      displayName: normalizedDisplayName,
    };
  }
  return {
    action: "save",
    displayName: normalizedDisplayName,
  };
}
