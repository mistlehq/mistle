export const AwsToolIds = {
  AWS_CLI: "aws-cli",
} as const;

export type AwsToolId = (typeof AwsToolIds)[keyof typeof AwsToolIds];
