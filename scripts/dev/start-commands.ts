export type DevStartupCommand = {
  args: readonly string[];
  command: string;
  label: string;
};

export function createControlPlaneStartupCommands(): readonly DevStartupCommand[] {
  return [
    {
      label: "Running control-plane DB migrations...",
      command: "pnpm",
      args: ["--filter", "@mistle/control-plane-api", "db:migrate"],
    },
    {
      label: "Syncing integration targets...",
      command: "pnpm",
      args: ["--filter", "@mistle/control-plane-api", "integration-targets:sync"],
    },
    {
      label: "Running control-plane workflow migrations...",
      command: "pnpm",
      args: ["--filter", "@mistle/control-plane-api", "workflow:migrate"],
    },
  ];
}
