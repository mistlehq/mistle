import type { RuntimeArtifactCommand, RuntimeArtifactSpec } from "@mistle/integrations-core";
import { describe, expect, it } from "vitest";

import {
  AwsConnectionMethodIds,
  AwsCredentialResolverKeys,
  AwsCredentialSecretTypes,
  AwsCredentialSlotKeys,
} from "./auth.js";
import { compileAwsBinding } from "./compile-binding.js";
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
  install: ReadonlyArray<RuntimeArtifactCommand>;
} {
  const refs = {
    command: {
      exec(input: RuntimeArtifactCommand): RuntimeArtifactCommand {
        return input;
      },
    },
    sandboxPaths: SandboxPaths,
    artifactBinPath,
    mise: {
      install(input: { tools: ReadonlyArray<string>; force?: boolean; timeoutMs?: number }) {
        return {
          args: ["mise", "install", ...input.tools],
        };
      },
    },
    githubReleases: {
      installLatestBinary() {
        return {
          args: ["github-releases.installLatestBinary"],
        };
      },
      installTaggedBinary() {
        return {
          args: ["github-releases.installTaggedBinary"],
        };
      },
      installLatestTaggedAsset() {
        return {
          args: ["github-releases.installLatestTaggedAsset"],
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
      args: expect.arrayContaining(["sh", "-euc", expect.any(String)]),
      timeoutMs: 120000,
    });
    expect(installCommand?.args[2]).toContain(
      "https://awscli.amazonaws.com/awscli-exe-linux-x86_64-2.31.22.zip",
    );
    expect(installCommand?.args[2]).toContain(
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
});
