export const GitHubToolIds = {
  GITHUB_CLI: "github-cli",
} as const;

export type GitHubToolId = (typeof GitHubToolIds)[keyof typeof GitHubToolIds];
