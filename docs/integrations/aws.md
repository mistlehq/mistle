# AWS Integration

The AWS integration gives sandboxes scoped AWS access without writing long-lived AWS secrets into the sandbox environment. Mistle stores the configured source access key secret, assumes the configured IAM role, and applies the resulting credentials through managed egress.

## Connection Setup

Use the **Access key + AssumeRole** connection method when the organization has an IAM principal that can assume the sandbox role.

- **Access key ID** and **Secret access key** identify the source IAM principal used to call STS `AssumeRole`.
- **Role ARN** is the IAM role the sandbox should use. The role trust policy must allow the source principal to assume it.
- **External ID** is only needed when the role trust policy checks `sts:ExternalId`.
- **Duration seconds** is the temporary STS session lifetime. Leave it blank to use the AWS default; set a value from `900` to `43200` only when the role allows that duration.

## Binding Setup

AWS bindings control what a sandbox profile can reach and which AWS tools are installed.

- **Services** are the AWS service endpoints allowed through managed egress.
- **Regions** are the AWS regions where those service endpoints may be reached.
- **Default region** is the region injected into AWS tools when a command or MCP call does not specify a region. It must be one of the selected regions.
- **Tools** selects the sandbox tooling. **AWS CLI** installs the `aws` command. **CloudWatch MCP** exposes CloudWatch and CloudWatch Logs MCP tools to agents.

Selecting **CloudWatch MCP** automatically includes the CloudWatch and CloudWatch Logs service routes needed by the MCP server. The selected regions still control where those routes are allowed.

## CloudWatch MCP Runtime

CloudWatch MCP is installed as a pinned upstream AWS Labs runtime artifact, then launched through Mistle's wrapper command. The wrapper provides placeholder AWS files so the upstream boto3-based server can construct AWS requests, while managed egress applies the real credentials from the integration connection.

That means the sandbox may not show ordinary `AWS_ACCESS_KEY_ID` or `AWS_SECRET_ACCESS_KEY` environment variables. A missing local key in `aws configure list` is expected in managed sandboxes; the important check is whether AWS requests succeed through the managed egress path.

## Troubleshooting

- `AccessDenied` from AWS usually means the assumed role is reachable but lacks the requested CloudWatch, CloudWatch Logs, or STS permission.
- `UnrecognizedClientException` or `MissingAuthenticationToken` usually means the AWS request was not accepted as authenticated. Check whether the connection can still assume the role and whether the selected region is covered by the binding.
- `Control-plane internal credential resolution failed` means Mistle's credential resolution path failed before a usable AWS credential reached the request. Retry after the connection is healthy; if it persists, inspect control-plane logs rather than CloudWatch logs.
- `CERTIFICATE_VERIFY_FAILED` in a sandbox usually means the tool did not pick up the managed proxy CA bundle. Provider CLIs and MCP wrappers should use the sandbox CA configuration instead of disabling TLS validation.
