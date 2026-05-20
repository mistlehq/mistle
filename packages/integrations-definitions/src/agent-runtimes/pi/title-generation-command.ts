const PiTitleGenerationCommand = [
  "PI_SKIP_VERSION_CHECK=1",
  "PI_TELEMETRY=0",
  "pi",
  "--no-session",
  "--no-tools",
  "--no-context-files",
  "--no-skills",
  "--no-prompt-templates",
  "--no-extensions",
  "-p",
].join(" ");

export function buildPiTitleGenerationShellScript(): string {
  return PiTitleGenerationCommand;
}
