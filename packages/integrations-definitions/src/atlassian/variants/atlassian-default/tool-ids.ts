export const AtlassianToolIds = {
  JIRA_CLI: "jira-cli",
} as const;

export type AtlassianToolId = (typeof AtlassianToolIds)[keyof typeof AtlassianToolIds];
