import {
  IntegrationConnectionStatuses,
  type RuntimeArtifactCommand,
  type RuntimeArtifactSpec,
} from "@mistle/integrations-core";
import { describe, expect, it } from "vitest";

import { compileAwsCliDefaultBinding } from "./compile-binding.js";

function artifactBinPath(name: string): string {
  return `/usr/local/bin/${name}`;
}

const SandboxPaths = {
  userHomeDir: "/root",
  workspaceDir: "/root",
  runtimeDataDir: "/var/lib/mistle",
  runtimeArtifactDir: "/var/lib/mistle/artifacts",
  runtimeArtifactBinDir: "/usr/local/bin",
};

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

function createCompileInput(input: {
  services: ReadonlyArray<string>;
  regions: ReadonlyArray<string>;
  defaultRegion: string;
}): Parameters<typeof compileAwsCliDefaultBinding>[0] {
  return {
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
      id: "icn_123",
      status: IntegrationConnectionStatuses.ACTIVE,
      config: {
        connection_method: "aws-assume-role",
        accessKeyId: "AKIA1234567890",
        roleArn: "arn:aws:iam::123456789012:role/mistle-sandbox",
      },
    },
    binding: {
      id: "ibd_123",
      kind: "agent",
      config: {
        services: [...input.services],
        regions: [...input.regions],
        defaultRegion: input.defaultRegion,
      },
    },
    refs: {
      sandboxPaths: SandboxPaths,
      artifactBinPath,
    },
  };
}

describe("compileAwsCliDefaultBinding", () => {
  it("builds regional AWS SigV4 routes plus wrapper and config files", () => {
    const compiled = compileAwsCliDefaultBinding(
      createCompileInput({
        services: ["lambda", "ec2"],
        regions: ["us-west-2", "us-east-1"],
        defaultRegion: "us-east-1",
      }),
    );

    expect(compiled.egressRoutes).toEqual([
      {
        match: {
          hosts: ["ec2.us-east-1.amazonaws.com"],
          pathPrefixes: ["/"],
          methods: ["DELETE", "GET", "HEAD", "PATCH", "POST", "PUT"],
        },
        upstream: {
          baseUrl: "https://ec2.us-east-1.amazonaws.com",
        },
        authInjection: {
          type: "aws_sigv4",
          service: "ec2",
          region: "us-east-1",
        },
        credentialResolver: {
          connectionId: "icn_123",
          secretType: "aws_secret_access_key",
          purpose: "aws_secret_access_key",
          resolverKey: "assume_role_session",
        },
      },
      {
        match: {
          hosts: ["ec2.us-west-2.amazonaws.com"],
          pathPrefixes: ["/"],
          methods: ["DELETE", "GET", "HEAD", "PATCH", "POST", "PUT"],
        },
        upstream: {
          baseUrl: "https://ec2.us-west-2.amazonaws.com",
        },
        authInjection: {
          type: "aws_sigv4",
          service: "ec2",
          region: "us-west-2",
        },
        credentialResolver: {
          connectionId: "icn_123",
          secretType: "aws_secret_access_key",
          purpose: "aws_secret_access_key",
          resolverKey: "assume_role_session",
        },
      },
      {
        match: {
          hosts: ["lambda.us-east-1.amazonaws.com"],
          pathPrefixes: ["/"],
          methods: ["DELETE", "GET", "HEAD", "PATCH", "POST", "PUT"],
        },
        upstream: {
          baseUrl: "https://lambda.us-east-1.amazonaws.com",
        },
        authInjection: {
          type: "aws_sigv4",
          service: "lambda",
          region: "us-east-1",
        },
        credentialResolver: {
          connectionId: "icn_123",
          secretType: "aws_secret_access_key",
          purpose: "aws_secret_access_key",
          resolverKey: "assume_role_session",
        },
      },
      {
        match: {
          hosts: ["lambda.us-west-2.amazonaws.com"],
          pathPrefixes: ["/"],
          methods: ["DELETE", "GET", "HEAD", "PATCH", "POST", "PUT"],
        },
        upstream: {
          baseUrl: "https://lambda.us-west-2.amazonaws.com",
        },
        authInjection: {
          type: "aws_sigv4",
          service: "lambda",
          region: "us-west-2",
        },
        credentialResolver: {
          connectionId: "icn_123",
          secretType: "aws_secret_access_key",
          purpose: "aws_secret_access_key",
          resolverKey: "assume_role_session",
        },
      },
    ]);

    expect(compiled.runtimeClients).toEqual([
      {
        clientId: "aws-cli-bootstrap",
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
                'exec "/usr/local/aws-cli-mistle/v2/current/bin/aws" --no-sign-request "$@"',
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

    expect(compiled.artifacts).toHaveLength(1);
    const artifact = compiled.artifacts[0];
    expect(artifact?.artifactKey).toBe("aws-cli");
    expect(artifact?.name).toBe("AWS CLI");
    if (artifact === undefined) {
      throw new Error("Expected compiled AWS CLI artifact.");
    }
    expect(resolveArtifactLifecycleCommands(artifact)).toEqual({
      install: [
        {
          args: [
            "sh",
            "-euc",
            expect.stringContaining(
              "https://awscli.amazonaws.com/awscli-exe-linux-x86_64-2.34.20.zip",
            ),
          ],
          timeoutMs: 120_000,
        },
      ],
    });
  });

  it("adds global endpoints for IAM and STS", () => {
    const compiled = compileAwsCliDefaultBinding(
      createCompileInput({
        services: ["iam", "sts"],
        regions: ["us-east-1"],
        defaultRegion: "us-east-1",
      }),
    );

    expect(compiled.egressRoutes).toEqual([
      expect.objectContaining({
        match: {
          hosts: ["iam.amazonaws.com"],
          pathPrefixes: ["/"],
          methods: ["DELETE", "GET", "HEAD", "PATCH", "POST", "PUT"],
        },
        authInjection: {
          type: "aws_sigv4",
          service: "iam",
          region: "us-east-1",
        },
      }),
      expect.objectContaining({
        match: {
          hosts: ["sts.amazonaws.com"],
          pathPrefixes: ["/"],
          methods: ["DELETE", "GET", "HEAD", "PATCH", "POST", "PUT"],
        },
        authInjection: {
          type: "aws_sigv4",
          service: "sts",
          region: "us-east-1",
        },
      }),
      expect.objectContaining({
        match: {
          hosts: ["sts.us-east-1.amazonaws.com"],
          pathPrefixes: ["/"],
          methods: ["DELETE", "GET", "HEAD", "PATCH", "POST", "PUT"],
        },
        authInjection: {
          type: "aws_sigv4",
          service: "sts",
          region: "us-east-1",
        },
      }),
    ]);
  });

  it("adds constrained path-style S3 hosts", () => {
    const compiled = compileAwsCliDefaultBinding(
      createCompileInput({
        services: ["s3"],
        regions: ["us-east-1", "us-west-2"],
        defaultRegion: "us-west-2",
      }),
    );

    expect(compiled.egressRoutes).toEqual([
      expect.objectContaining({
        match: {
          hosts: ["s3.amazonaws.com"],
          pathPrefixes: ["/"],
          methods: ["DELETE", "GET", "HEAD", "PATCH", "POST", "PUT"],
        },
        authInjection: {
          type: "aws_sigv4",
          service: "s3",
          region: "us-east-1",
        },
      }),
      expect.objectContaining({
        match: {
          hosts: ["s3.us-east-1.amazonaws.com"],
          pathPrefixes: ["/"],
          methods: ["DELETE", "GET", "HEAD", "PATCH", "POST", "PUT"],
        },
        authInjection: {
          type: "aws_sigv4",
          service: "s3",
          region: "us-east-1",
        },
      }),
      expect.objectContaining({
        match: {
          hosts: ["s3.us-west-2.amazonaws.com"],
          pathPrefixes: ["/"],
          methods: ["DELETE", "GET", "HEAD", "PATCH", "POST", "PUT"],
        },
        authInjection: {
          type: "aws_sigv4",
          service: "s3",
          region: "us-west-2",
        },
      }),
    ]);
  });

  it("rejects unsupported services and regions", () => {
    expect(() =>
      compileAwsCliDefaultBinding(
        createCompileInput({
          services: ["not-a-real-service"],
          regions: ["us-east-1"],
          defaultRegion: "us-east-1",
        }),
      ),
    ).toThrow("Unsupported AWS service 'not-a-real-service'.");

    expect(() =>
      compileAwsCliDefaultBinding(
        createCompileInput({
          services: ["sts"],
          regions: ["moon-1"],
          defaultRegion: "moon-1",
        }),
      ),
    ).toThrow("Unsupported AWS region 'moon-1'.");
  });
});
