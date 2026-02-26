export type ScaffoldSandboxProfile = {
  id: string;
  displayName: string;
  status: "Active" | "Inactive";
  model: string;
  executables: string;
  triggers: string;
  updated: string;
};

export const SANDBOX_PROFILE_SCAFFOLD_ROWS: readonly ScaffoldSandboxProfile[] = [
  {
    id: "sandboxProfile_scaffold_active",
    displayName: "Default profile",
    status: "Active",
    model: "openai",
    executables: "2 enabled",
    triggers: "2 rules",
    updated: "2026-02-25T11:04:00Z",
  },
  {
    id: "sandboxProfile_scaffold_inactive",
    displayName: "Repository sync profile",
    status: "Inactive",
    model: "Unbound",
    executables: "0 enabled",
    triggers: "0 rules",
    updated: "2026-02-24T19:20:00Z",
  },
];

export function resolveScaffoldProfileDisplayName(profileId: string): string | null {
  const matched = SANDBOX_PROFILE_SCAFFOLD_ROWS.find((profile) => profile.id === profileId);
  return matched?.displayName ?? null;
}
