# AWS Integration

The AWS integration gives sandboxes scoped AWS access without writing long-lived AWS secrets into the sandbox environment. Mistle stores the configured source access key secret, assumes the configured IAM role, and applies the resulting credentials through managed egress.

## Connection Setup

Use the **Access key + AssumeRole** connection method when the organization has an IAM principal that can assume the sandbox role.

- **Access key ID** and **Secret access key** identify the source IAM principal used to call STS `AssumeRole`.
- **Role ARN** is the IAM role the sandbox should use. The role trust policy must allow the source principal to assume it.
- **External ID** is only needed when the role trust policy checks `sts:ExternalId`.
- **Duration seconds** is the temporary STS session lifetime. Leave it blank to use the AWS default; set a value from `900` to `43200` only when the role allows that duration.

## Example: CloudWatch Read-Only Role

The AWS connection needs both a source IAM principal and a target IAM role:

```text
IAM user access key
    -> calls sts:AssumeRole
IAM role
    -> grants CloudWatch and CloudWatch Logs permissions
```

Do not put an IAM user ARN in the **Role ARN** field. The role ARN must look like `arn:aws:iam::123456789012:role/mistle-cloudwatch-role`, not `arn:aws:iam::123456789012:user/mistle-cloudwatch-source`.

One minimal setup is:

1. Create an IAM user for the source access key, for example `mistle-cloudwatch-source`.
2. Create an access key for that user. Use its access key ID and secret access key in the Mistle connection form.
3. Create an IAM role for the sandbox permissions, for example `mistle-cloudwatch-role`.
4. Give the IAM user permission to call `sts:AssumeRole` on that role.
5. Give the IAM role read-only CloudWatch permissions.
6. Configure the role trust policy so the role trusts the IAM user.

The IAM user needs permission to assume only the target role:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "sts:AssumeRole",
      "Resource": "arn:aws:iam::123456789012:role/mistle-cloudwatch-role"
    }
  ]
}
```

Attach CloudWatch permissions to the role, not to the source user. For broad testing, AWS-managed `ReadOnlyAccess` is usually enough. For a narrower production setup, start with AWS-managed `CloudWatchReadOnlyAccess` and `CloudWatchLogsReadOnlyAccess`, then narrow further if your account policy requires it.

The role trust policy must allow the source user to assume the role:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "AWS": "arn:aws:iam::123456789012:user/mistle-cloudwatch-source"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
```

Then configure the Mistle AWS connection with:

```text
Access key ID:     source user access key ID
Secret access key: source user secret access key
Role ARN:          arn:aws:iam::123456789012:role/mistle-cloudwatch-role
External ID:       blank, unless your trust policy requires one
Duration seconds:  3600, or blank to use the AWS default
```

If the connection fails with `AccessDenied` and the message says AWS tried to assume a resource under `/user/`, the connection is using an IAM user ARN where it needs an IAM role ARN.

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

- `AccessDenied` during STS `AssumeRole` means the connection could not assume the configured role. Check that the access key belongs to the intended source principal, the source principal can call `sts:AssumeRole` on the role, the role trust policy allows that source principal, and the external ID matches if one is configured.
- `AccessDenied` from CloudWatch or CloudWatch Logs means Mistle assumed the role, but the role lacks permission for the requested CloudWatch or Logs action.
- `UnrecognizedClientException` or `MissingAuthenticationToken` usually means the AWS request was not accepted as authenticated. Check whether the connection can still assume the role and whether the selected region is covered by the binding.
- `Control-plane internal credential resolution failed` means Mistle's credential resolution path failed before a usable AWS credential reached the request. Retry after the connection is healthy; if it persists, inspect control-plane logs rather than CloudWatch logs.
- `CERTIFICATE_VERIFY_FAILED` in a sandbox usually means the tool did not pick up the managed proxy CA bundle. Provider CLIs and MCP wrappers should use the sandbox CA configuration instead of disabling TLS validation.
