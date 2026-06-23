export const GoogleBusinessProfileCliToolId = "google-business-profile-cli";
export const GoogleBusinessProfileMcpToolId = "google-business-profile-mcp";

export const GoogleBusinessProfileToolIds = {
  GOOGLE_BUSINESS_PROFILE_CLI: GoogleBusinessProfileCliToolId,
  GOOGLE_BUSINESS_PROFILE_MCP: GoogleBusinessProfileMcpToolId,
};

export type GoogleBusinessProfileToolId =
  (typeof GoogleBusinessProfileToolIds)[keyof typeof GoogleBusinessProfileToolIds];
