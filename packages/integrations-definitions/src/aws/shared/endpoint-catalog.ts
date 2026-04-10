type AwsEndpointKind = "regional" | "global" | "regional_and_global";

export type AwsEndpointServiceDefinition = {
  id: string;
  displayName: string;
  endpointKind: AwsEndpointKind;
  signingName: string;
  regionalHostnameTemplate?: string;
  globalHostname?: string;
  globalSigningRegion?: string;
};

export const AwsSupportedRegionIds = [
  "af-south-1",
  "ap-east-1",
  "ap-east-2",
  "ap-northeast-1",
  "ap-northeast-2",
  "ap-northeast-3",
  "ap-south-1",
  "ap-south-2",
  "ap-southeast-1",
  "ap-southeast-2",
  "ap-southeast-3",
  "ap-southeast-4",
  "ap-southeast-5",
  "ap-southeast-6",
  "ap-southeast-7",
  "ca-central-1",
  "ca-west-1",
  "eu-central-1",
  "eu-central-2",
  "eu-north-1",
  "eu-south-1",
  "eu-south-2",
  "eu-west-1",
  "eu-west-2",
  "eu-west-3",
  "il-central-1",
  "me-central-1",
  "me-south-1",
  "mx-central-1",
  "sa-east-1",
  "us-east-1",
  "us-east-2",
  "us-west-1",
  "us-west-2",
] as const;

export const AwsEndpointServiceDefinitions = [
  {
    id: "acm",
    displayName: "AWS Certificate Manager",
    endpointKind: "regional",
    signingName: "acm",
  },
  {
    id: "apigateway",
    displayName: "API Gateway",
    endpointKind: "regional",
    signingName: "apigateway",
  },
  {
    id: "cloudformation",
    displayName: "CloudFormation",
    endpointKind: "regional",
    signingName: "cloudformation",
  },
  {
    id: "cloudwatch",
    displayName: "CloudWatch",
    endpointKind: "regional",
    signingName: "monitoring",
    regionalHostnameTemplate: "monitoring.{region}.amazonaws.com",
  },
  {
    id: "dynamodb",
    displayName: "DynamoDB",
    endpointKind: "regional",
    signingName: "dynamodb",
  },
  {
    id: "ec2",
    displayName: "EC2",
    endpointKind: "regional",
    signingName: "ec2",
  },
  {
    id: "ecr",
    displayName: "Elastic Container Registry",
    endpointKind: "regional",
    signingName: "ecr",
    regionalHostnameTemplate: "api.ecr.{region}.amazonaws.com",
  },
  {
    id: "ecs",
    displayName: "Elastic Container Service",
    endpointKind: "regional",
    signingName: "ecs",
  },
  {
    id: "events",
    displayName: "EventBridge",
    endpointKind: "regional",
    signingName: "events",
  },
  {
    id: "iam",
    displayName: "IAM",
    endpointKind: "global",
    signingName: "iam",
    globalHostname: "iam.amazonaws.com",
    globalSigningRegion: "us-east-1",
  },
  {
    id: "kms",
    displayName: "KMS",
    endpointKind: "regional",
    signingName: "kms",
  },
  {
    id: "lambda",
    displayName: "Lambda",
    endpointKind: "regional",
    signingName: "lambda",
  },
  {
    id: "logs",
    displayName: "CloudWatch Logs",
    endpointKind: "regional",
    signingName: "logs",
  },
  {
    id: "rds",
    displayName: "RDS",
    endpointKind: "regional",
    signingName: "rds",
  },
  {
    id: "s3",
    displayName: "S3",
    endpointKind: "regional_and_global",
    signingName: "s3",
    globalHostname: "s3.amazonaws.com",
    globalSigningRegion: "us-east-1",
  },
  {
    id: "secretsmanager",
    displayName: "Secrets Manager",
    endpointKind: "regional",
    signingName: "secretsmanager",
  },
  {
    id: "sns",
    displayName: "SNS",
    endpointKind: "regional",
    signingName: "sns",
  },
  {
    id: "sqs",
    displayName: "SQS",
    endpointKind: "regional",
    signingName: "sqs",
  },
  {
    id: "ssm",
    displayName: "Systems Manager",
    endpointKind: "regional",
    signingName: "ssm",
  },
  {
    id: "sts",
    displayName: "STS",
    endpointKind: "regional_and_global",
    signingName: "sts",
    globalHostname: "sts.amazonaws.com",
    globalSigningRegion: "us-east-1",
  },
] as const satisfies ReadonlyArray<AwsEndpointServiceDefinition>;

const AwsEndpointServiceDefinitionById = new Map<string, AwsEndpointServiceDefinition>(
  AwsEndpointServiceDefinitions.map((definition) => [definition.id, definition] as const),
);

const AwsSupportedRegionIdSet = new Set<string>(AwsSupportedRegionIds);

export function isAwsSupportedRegionId(regionId: string): boolean {
  return AwsSupportedRegionIdSet.has(regionId);
}

export function resolveAwsEndpointServiceDefinition(
  serviceId: string,
): AwsEndpointServiceDefinition | undefined {
  return AwsEndpointServiceDefinitionById.get(serviceId);
}

export function renderAwsRegionalHostname(input: {
  serviceId: string;
  region: string;
  regionalHostnameTemplate?: string;
}): string {
  return (input.regionalHostnameTemplate ?? "{service}.{region}.amazonaws.com")
    .replace("{service}", input.serviceId)
    .replace("{region}", input.region);
}
