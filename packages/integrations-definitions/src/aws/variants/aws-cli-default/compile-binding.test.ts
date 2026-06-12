import type {
  RuntimeArtifactInstallStep,
  RuntimeArtifactSpec,
  RuntimeExecCommand,
} from "@mistle/integrations-core";
import { describe, expect, it } from "vitest";

import {
  AwsConnectionMethodIds,
  AwsCredentialResolverKeys,
  AwsCredentialSecretTypes,
  AwsCredentialSlotKeys,
} from "./auth.js";
import { AwsCloudWatchMcpWrapperPath, compileAwsBinding } from "./compile-binding.js";
import { AwsToolIds } from "./tool-ids.js";

function artifactBinPath(name: string): string {
  return `/usr/local/bin/${name}`;
}

const SandboxPaths = {
  userHomeDir: "/root",
  workspaceDir: "/root",
  runtimeDataDir: "/var/lib/mistle",
  runtimeArtifactDir: "/var/lib/mistle/artifacts",
  runtimeArtifactBinDir: "/usr/local/bin",
} as const;

function resolveArtifactLifecycleCommands(artifact: RuntimeArtifactSpec): {
  install: ReadonlyArray<RuntimeArtifactInstallStep>;
} {
  const refs = {
    command: {
      exec(input: RuntimeExecCommand): RuntimeArtifactInstallStep {
        return {
          op: "exec",
          command: input,
        };
      },
    },
    sandboxPaths: SandboxPaths,
    artifactBinPath,
    mise: {
      install(input: {
        tools: ReadonlyArray<string>;
        force?: boolean;
        timeoutMs?: number;
      }): RuntimeArtifactInstallStep {
        return {
          op: "exec",
          command: {
            args: ["mise", "install", ...input.tools],
          },
        };
      },
    },
    githubReleases: {
      install(): RuntimeArtifactInstallStep {
        return {
          op: "exec",
          command: {
            args: ["github-releases.install"],
          },
        };
      },
    },
    compileContext: {
      organizationId: "org_123",
      sandboxProfileId: "sbp_123",
      version: 1,
      targetKey: "aws-cli-default",
      bindingId: "ibd_123",
    },
  };

  const install =
    typeof artifact.lifecycle.install === "function"
      ? artifact.lifecycle.install({ refs })
      : artifact.lifecycle.install;
  return {
    install,
  };
}

describe("compileAwsBinding", () => {
  it("builds exact AWS routes and managed CLI runtime material when aws-cli is selected", () => {
    const compiled = compileAwsBinding({
      organizationId: "org_123",
      sandboxProfileId: "sbp_123",
      version: 1,
      targetKey: "aws-cli-default",
      target: {
        familyId: "aws",
        variantId: "aws-cli-default",
        enabled: true,
        config: {},
        secrets: {},
      },
      connection: {
        id: "icn_aws",
        status: "active",
        config: {
          connection_method: AwsConnectionMethodIds.AWS_ASSUME_ROLE,
          accessKeyId: "AKIAEXAMPLE",
          roleArn: "arn:aws:iam::123456789012:role/mistle-dev",
          durationSeconds: 3600,
        },
      },
      binding: {
        id: "ibd_123",
        kind: "connector",
        config: {
          services: ["sts", "secretsmanager", "s3", "iam"],
          regions: ["us-west-2", "us-east-1"],
          defaultRegion: "us-east-1",
          tools: [AwsToolIds.AWS_CLI],
        },
      },
      refs: {
        sandboxPaths: SandboxPaths,
        artifactBinPath,
      },
    });

    expect(compiled.egressRoutes).toEqual([
      {
        match: {
          hosts: ["iam.amazonaws.com"],
        },
        upstream: {
          baseUrl: "https://iam.amazonaws.com",
        },
        authInjection: {
          type: "aws_sigv4",
          service: "iam",
          region: "us-east-1",
        },
        credentialResolver: {
          kind: "integration_connection",
          connectionId: "icn_aws",
          secretType: AwsCredentialSecretTypes.AWS_SECRET_ACCESS_KEY,
          slotKey: AwsCredentialSlotKeys.SECRET_ACCESS_KEY,
          resolverKey: AwsCredentialResolverKeys.ASSUME_ROLE_SESSION,
        },
      },
      {
        match: {
          hosts: ["s3.amazonaws.com"],
        },
        upstream: {
          baseUrl: "https://s3.amazonaws.com",
        },
        authInjection: {
          type: "aws_sigv4",
          service: "s3",
          region: "us-east-1",
        },
        credentialResolver: {
          kind: "integration_connection",
          connectionId: "icn_aws",
          secretType: AwsCredentialSecretTypes.AWS_SECRET_ACCESS_KEY,
          slotKey: AwsCredentialSlotKeys.SECRET_ACCESS_KEY,
          resolverKey: AwsCredentialResolverKeys.ASSUME_ROLE_SESSION,
        },
      },
      {
        match: {
          hosts: ["s3.us-east-1.amazonaws.com"],
        },
        upstream: {
          baseUrl: "https://s3.us-east-1.amazonaws.com",
        },
        authInjection: {
          type: "aws_sigv4",
          service: "s3",
          region: "us-east-1",
        },
        credentialResolver: {
          kind: "integration_connection",
          connectionId: "icn_aws",
          secretType: AwsCredentialSecretTypes.AWS_SECRET_ACCESS_KEY,
          slotKey: AwsCredentialSlotKeys.SECRET_ACCESS_KEY,
          resolverKey: AwsCredentialResolverKeys.ASSUME_ROLE_SESSION,
        },
      },
      {
        match: {
          hosts: ["s3.us-west-2.amazonaws.com"],
        },
        upstream: {
          baseUrl: "https://s3.us-west-2.amazonaws.com",
        },
        authInjection: {
          type: "aws_sigv4",
          service: "s3",
          region: "us-west-2",
        },
        credentialResolver: {
          kind: "integration_connection",
          connectionId: "icn_aws",
          secretType: AwsCredentialSecretTypes.AWS_SECRET_ACCESS_KEY,
          slotKey: AwsCredentialSlotKeys.SECRET_ACCESS_KEY,
          resolverKey: AwsCredentialResolverKeys.ASSUME_ROLE_SESSION,
        },
      },
      {
        match: {
          hosts: ["secretsmanager.us-east-1.amazonaws.com"],
        },
        upstream: {
          baseUrl: "https://secretsmanager.us-east-1.amazonaws.com",
        },
        authInjection: {
          type: "aws_sigv4",
          service: "secretsmanager",
          region: "us-east-1",
        },
        credentialResolver: {
          kind: "integration_connection",
          connectionId: "icn_aws",
          secretType: AwsCredentialSecretTypes.AWS_SECRET_ACCESS_KEY,
          slotKey: AwsCredentialSlotKeys.SECRET_ACCESS_KEY,
          resolverKey: AwsCredentialResolverKeys.ASSUME_ROLE_SESSION,
        },
      },
      {
        match: {
          hosts: ["secretsmanager.us-west-2.amazonaws.com"],
        },
        upstream: {
          baseUrl: "https://secretsmanager.us-west-2.amazonaws.com",
        },
        authInjection: {
          type: "aws_sigv4",
          service: "secretsmanager",
          region: "us-west-2",
        },
        credentialResolver: {
          kind: "integration_connection",
          connectionId: "icn_aws",
          secretType: AwsCredentialSecretTypes.AWS_SECRET_ACCESS_KEY,
          slotKey: AwsCredentialSlotKeys.SECRET_ACCESS_KEY,
          resolverKey: AwsCredentialResolverKeys.ASSUME_ROLE_SESSION,
        },
      },
      {
        match: {
          hosts: ["sts.amazonaws.com"],
        },
        upstream: {
          baseUrl: "https://sts.amazonaws.com",
        },
        authInjection: {
          type: "aws_sigv4",
          service: "sts",
          region: "us-east-1",
        },
        credentialResolver: {
          kind: "integration_connection",
          connectionId: "icn_aws",
          secretType: AwsCredentialSecretTypes.AWS_SECRET_ACCESS_KEY,
          slotKey: AwsCredentialSlotKeys.SECRET_ACCESS_KEY,
          resolverKey: AwsCredentialResolverKeys.ASSUME_ROLE_SESSION,
        },
      },
      {
        match: {
          hosts: ["sts.us-east-1.amazonaws.com"],
        },
        upstream: {
          baseUrl: "https://sts.us-east-1.amazonaws.com",
        },
        authInjection: {
          type: "aws_sigv4",
          service: "sts",
          region: "us-east-1",
        },
        credentialResolver: {
          kind: "integration_connection",
          connectionId: "icn_aws",
          secretType: AwsCredentialSecretTypes.AWS_SECRET_ACCESS_KEY,
          slotKey: AwsCredentialSlotKeys.SECRET_ACCESS_KEY,
          resolverKey: AwsCredentialResolverKeys.ASSUME_ROLE_SESSION,
        },
      },
      {
        match: {
          hosts: ["sts.us-west-2.amazonaws.com"],
        },
        upstream: {
          baseUrl: "https://sts.us-west-2.amazonaws.com",
        },
        authInjection: {
          type: "aws_sigv4",
          service: "sts",
          region: "us-west-2",
        },
        credentialResolver: {
          kind: "integration_connection",
          connectionId: "icn_aws",
          secretType: AwsCredentialSecretTypes.AWS_SECRET_ACCESS_KEY,
          slotKey: AwsCredentialSlotKeys.SECRET_ACCESS_KEY,
          resolverKey: AwsCredentialResolverKeys.ASSUME_ROLE_SESSION,
        },
      },
    ]);

    expect(compiled.artifacts).toHaveLength(1);
    const artifact = compiled.artifacts[0];
    expect(artifact?.artifactKey).toBe("aws-cli");
    expect(artifact?.name).toBe("AWS CLI");
    expect(artifact?.env).toBeUndefined();
    if (artifact === undefined) {
      throw new Error("Expected compiled aws artifact.");
    }
    const installCommand = resolveArtifactLifecycleCommands(artifact).install[0];
    expect(installCommand).toEqual({
      op: "exec",
      command: {
        args: expect.arrayContaining(["sh", "-euc", expect.any(String)]),
        timeoutMs: 120000,
      },
    });
    if (installCommand?.op !== "exec") {
      throw new Error("Expected aws artifact install step to remain an exec step in branch 1.");
    }
    expect(installCommand.command.args[2]).toContain('case "$(uname -m)" in');
    expect(installCommand.command.args[2]).toContain('aws_cli_arch="x86_64"');
    expect(installCommand.command.args[2]).toContain('aws_cli_arch="aarch64"');
    expect(installCommand.command.args[2]).toContain(
      'download_url="https://awscli.amazonaws.com/awscli-exe-linux-${aws_cli_arch}-${aws_cli_version}.zip"',
    );
    expect(installCommand.command.args[2]).toContain(
      '"$temp_dir/aws/install" --install-dir "$install_root" --bin-dir "$temp_dir/bin"',
    );

    expect(compiled.runtimeClients).toEqual([
      {
        clientId: "aws-cli-runtime",
        setup: {
          env: {},
          files: [
            {
              fileId: "aws_wrapper",
              path: "/usr/local/bin/aws",
              mode: 0o755,
              content: [
                "#!/bin/sh",
                "set -eu",
                'exec /usr/local/aws-cli-mistle/v2/current/bin/aws --no-sign-request "$@"',
              ].join("\n"),
            },
            {
              fileId: "aws_config",
              path: "/root/.aws/config",
              mode: 0o600,
              content: [
                "[default]",
                "region = us-east-1",
                "output = json",
                "s3 =",
                "  addressing_style = path",
                "  use_accelerate_endpoint = false",
                "  use_dualstack_endpoint = false",
                "",
              ].join("\n"),
            },
          ],
        },
        processes: [],
        endpoints: [],
      },
    ]);
  });

  it("omits the managed aws cli artifact and runtime client when aws-cli is not selected", () => {
    const compiled = compileAwsBinding({
      organizationId: "org_123",
      sandboxProfileId: "sbp_123",
      version: 1,
      targetKey: "aws-cli-default",
      target: {
        familyId: "aws",
        variantId: "aws-cli-default",
        enabled: true,
        config: {},
        secrets: {},
      },
      connection: {
        id: "icn_aws",
        status: "active",
        config: {
          connection_method: AwsConnectionMethodIds.AWS_ASSUME_ROLE,
          accessKeyId: "AKIAEXAMPLE",
          roleArn: "arn:aws:iam::123456789012:role/mistle-dev",
        },
      },
      binding: {
        id: "ibd_123",
        kind: "connector",
        config: {
          services: ["secretsmanager"],
          regions: ["us-east-1"],
          defaultRegion: "us-east-1",
          tools: [],
        },
      },
      refs: {
        sandboxPaths: SandboxPaths,
        artifactBinPath,
      },
    });

    expect(compiled.egressRoutes).toEqual([
      {
        match: {
          hosts: ["secretsmanager.us-east-1.amazonaws.com"],
        },
        upstream: {
          baseUrl: "https://secretsmanager.us-east-1.amazonaws.com",
        },
        authInjection: {
          type: "aws_sigv4",
          service: "secretsmanager",
          region: "us-east-1",
        },
        credentialResolver: {
          kind: "integration_connection",
          connectionId: "icn_aws",
          secretType: AwsCredentialSecretTypes.AWS_SECRET_ACCESS_KEY,
          slotKey: AwsCredentialSlotKeys.SECRET_ACCESS_KEY,
          resolverKey: AwsCredentialResolverKeys.ASSUME_ROLE_SESSION,
        },
      },
    ]);
    expect(compiled.artifacts).toEqual([]);
    expect(compiled.runtimeClients).toEqual([]);
  });

  it("adds cloudwatch mcp artifact, wrapper, and required AWS routes independently from aws cli", () => {
    const compiled = compileAwsBinding({
      organizationId: "org_123",
      sandboxProfileId: "sbp_123",
      version: 1,
      targetKey: "aws-cli-default",
      target: {
        familyId: "aws",
        variantId: "aws-cli-default",
        enabled: true,
        config: {},
        secrets: {},
      },
      connection: {
        id: "icn_aws",
        status: "active",
        config: {
          connection_method: AwsConnectionMethodIds.AWS_ASSUME_ROLE,
          accessKeyId: "AKIAEXAMPLE",
          roleArn: "arn:aws:iam::123456789012:role/mistle-dev",
        },
      },
      binding: {
        id: "ibd_123",
        kind: "connector",
        config: {
          services: ["secretsmanager"],
          regions: ["us-east-1"],
          defaultRegion: "us-east-1",
          tools: [AwsToolIds.AWS_CLOUDWATCH_MCP],
        },
      },
      refs: {
        sandboxPaths: SandboxPaths,
        artifactBinPath,
      },
    });

    expect(
      compiled.egressRoutes.map((route) => ({
        host: route.match.hosts[0],
        authInjection: route.authInjection,
      })),
    ).toEqual([
      {
        host: "logs.us-east-1.amazonaws.com",
        authInjection: {
          type: "aws_sigv4",
          service: "logs",
          region: "us-east-1",
        },
      },
      {
        host: "monitoring.us-east-1.amazonaws.com",
        authInjection: {
          type: "aws_sigv4",
          service: "monitoring",
          region: "us-east-1",
        },
      },
      {
        host: "secretsmanager.us-east-1.amazonaws.com",
        authInjection: {
          type: "aws_sigv4",
          service: "secretsmanager",
          region: "us-east-1",
        },
      },
    ]);

    expect(compiled.artifacts).toHaveLength(1);
    const artifact = compiled.artifacts[0];
    expect(artifact?.artifactKey).toBe(AwsToolIds.AWS_CLOUDWATCH_MCP);
    expect(artifact?.name).toBe("AWS CloudWatch MCP");
    if (artifact === undefined) {
      throw new Error("Expected compiled cloudwatch mcp artifact.");
    }
    const installCommands = resolveArtifactLifecycleCommands(artifact).install;
    expect(installCommands).toHaveLength(2);
    expect(installCommands[0]).toEqual({
      op: "exec",
      command: {
        args: ["mise", "install", "python@3.13.14", "uv@0.11.20"],
      },
    });
    const installCommand = installCommands[1];
    if (installCommand?.op !== "exec") {
      throw new Error("Expected cloudwatch mcp package install step to be an exec step.");
    }
    expect(installCommand.command.args).toEqual([
      "sh",
      "-euc",
      expect.stringContaining('package_spec="awslabs.cloudwatch-mcp-server==0.1.4"'),
    ]);
    expect(installCommand.command.args[2]).toContain(
      'mise exec python@3.13.14 uv@0.11.20 -- uv tool install --force --python "$python_command" "$package_spec"',
    );
    expect(installCommand.command.args[2]).toContain(
      "/var/lib/mistle/artifacts/aws-cloudwatch-mcp/.local/bin/awslabs.cloudwatch-mcp-server",
    );

    expect(compiled.runtimeClients).toEqual([
      {
        clientId: "aws-cloudwatch-mcp-runtime",
        setup: {
          env: {},
          files: [
            {
              fileId: "aws_cloudwatch_mcp_wrapper",
              path: AwsCloudWatchMcpWrapperPath,
              mode: 0o755,
              content: [
                "#!/bin/sh",
                "set -eu",
                "",
                "unset AWS_PROFILE",
                "export AWS_ACCESS_KEY_ID=mistle-placeholder",
                "export AWS_SECRET_ACCESS_KEY=mistle-placeholder",
                'export AWS_REGION="us-east-1"',
                'export AWS_DEFAULT_REGION="us-east-1"',
                "export FASTMCP_LOG_LEVEL=ERROR",
                'export AWS_CA_BUNDLE="/run/mistle/sandboxd/egress-proxy-ca-bundle.pem"',
                'export SSL_CERT_FILE="/run/mistle/sandboxd/egress-proxy-ca-bundle.pem"',
                'export REQUESTS_CA_BUNDLE="/run/mistle/sandboxd/egress-proxy-ca-bundle.pem"',
                'export CURL_CA_BUNDLE="/run/mistle/sandboxd/egress-proxy-ca-bundle.pem"',
                'export AWS_CONFIG_FILE="/var/lib/mistle/artifacts/aws-cloudwatch-mcp/.aws/config"',
                'export AWS_SHARED_CREDENTIALS_FILE="/var/lib/mistle/artifacts/aws-cloudwatch-mcp/.aws/credentials"',
                'export HOME="/var/lib/mistle/artifacts/aws-cloudwatch-mcp"',
                'export UV_CACHE_DIR="/var/lib/mistle/artifacts/aws-cloudwatch-mcp/uv-cache"',
                "",
                'exec "/var/lib/mistle/artifacts/aws-cloudwatch-mcp/.local/bin/awslabs.cloudwatch-mcp-server" "$@"',
              ].join("\n"),
            },
            {
              fileId: "aws_cloudwatch_mcp_config",
              path: "/var/lib/mistle/artifacts/aws-cloudwatch-mcp/.aws/config",
              mode: 0o600,
              content: ["[default]", "region = us-east-1", "output = json", ""].join("\n"),
            },
            {
              fileId: "aws_cloudwatch_mcp_credentials",
              path: "/var/lib/mistle/artifacts/aws-cloudwatch-mcp/.aws/credentials",
              mode: 0o600,
              content: [
                "[default]",
                "aws_access_key_id = mistle-placeholder",
                "aws_secret_access_key = mistle-placeholder",
                "",
              ].join("\n"),
            },
          ],
        },
        processes: [],
        endpoints: [],
      },
    ]);
  });

  it("installs aws cli and cloudwatch mcp as independent artifacts when both tools are selected", () => {
    const compiled = compileAwsBinding({
      organizationId: "org_123",
      sandboxProfileId: "sbp_123",
      version: 1,
      targetKey: "aws-cli-default",
      target: {
        familyId: "aws",
        variantId: "aws-cli-default",
        enabled: true,
        config: {},
        secrets: {},
      },
      connection: {
        id: "icn_aws",
        status: "active",
        config: {
          connection_method: AwsConnectionMethodIds.AWS_ASSUME_ROLE,
          accessKeyId: "AKIAEXAMPLE",
          roleArn: "arn:aws:iam::123456789012:role/mistle-dev",
        },
      },
      binding: {
        id: "ibd_123",
        kind: "connector",
        config: {
          services: ["cloudwatch"],
          regions: ["us-east-1"],
          defaultRegion: "us-east-1",
          tools: [AwsToolIds.AWS_CLI, AwsToolIds.AWS_CLOUDWATCH_MCP],
        },
      },
      refs: {
        sandboxPaths: SandboxPaths,
        artifactBinPath,
      },
    });

    expect(compiled.artifacts.map((artifact) => artifact.artifactKey)).toEqual([
      AwsToolIds.AWS_CLI,
      AwsToolIds.AWS_CLOUDWATCH_MCP,
    ]);
    expect(compiled.runtimeClients.map((runtimeClient) => runtimeClient.clientId)).toEqual([
      "aws-cli-runtime",
      "aws-cloudwatch-mcp-runtime",
    ]);
    expect(compiled.egressRoutes.map((route) => route.match.hosts[0])).toEqual([
      "logs.us-east-1.amazonaws.com",
      "monitoring.us-east-1.amazonaws.com",
    ]);
  });
});
