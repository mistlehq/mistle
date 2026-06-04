export const JiraToolIds = {
  JIRA_CLI: "jira-cli",
  JIRA_MCP: "jira-mcp",
} as const;

export type JiraToolId = (typeof JiraToolIds)[keyof typeof JiraToolIds];
