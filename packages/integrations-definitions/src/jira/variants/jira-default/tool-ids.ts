export const JiraToolIds = {
  JIRA_CLI: "jira-cli",
} as const;

export type JiraToolId = (typeof JiraToolIds)[keyof typeof JiraToolIds];
