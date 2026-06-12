export const AwsToolIds = {
  AWS_CLI: "aws-cli",
  AWS_CLOUDWATCH_MCP: "aws-cloudwatch-mcp",
} as const;

export type AwsToolId = (typeof AwsToolIds)[keyof typeof AwsToolIds];
