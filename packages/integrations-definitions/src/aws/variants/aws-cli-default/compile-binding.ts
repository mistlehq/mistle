import {
  type CompileBindingEgressRoute,
  type CompileBindingInput,
  type CompileBindingResult,
} from "@mistle/integrations-core";

import {
  renderAwsRegionalHostname,
  resolveAwsEndpointServiceDefinition,
} from "../../shared/endpoint-catalog.js";
import {
  AwsAssumeRoleConnectionConfigSchema,
  AwsCredentialResolverKeys,
  AwsCredentialSecretTypes,
  AwsCredentialSlotKeys,
} from "./auth.js";
import type { AwsBindingConfig } from "./binding-config-schema.js";
import type { AwsTargetConfig } from "./target-config-schema.js";
import type { AwsTargetSecrets } from "./target-secret-schema.js";
import { AwsToolIds } from "./tool-ids.js";

export type AwsCompileBindingInput = CompileBindingInput<
  AwsTargetConfig,
  AwsBindingConfig,
  AwsTargetSecrets
>;

const AwsCliArtifactKey = "aws-cli";
const AwsCliArtifactName = "AWS CLI";
const AwsCliVersion = "2.31.22";
const AwsCliInstallRoot = "/usr/local/aws-cli-mistle";
const AwsCliManagedBinaryPath = `${AwsCliInstallRoot}/v2/current/bin/aws`;
const AwsCliWrapperPath = "/usr/local/bin/aws";
const AwsCliRuntimeClientId = "aws-cli-runtime";
const AwsCliWrapperFileId = "aws_wrapper";
const AwsCliConfigFileId = "aws_config";
const AwsCliConfigPath = "/root/.aws/config";
const AwsCloudWatchMcpArtifactName = "AWS CloudWatch MCP";
const AwsCloudWatchMcpPackageVersion = "0.1.4";
const AwsCloudWatchMcpPackage = `awslabs.cloudwatch-mcp-server==${AwsCloudWatchMcpPackageVersion}`;
const AwsCloudWatchMcpPythonTool = "python@3.13.14";
const AwsCloudWatchMcpPythonCommand = "python";
const AwsCloudWatchMcpUvTool = "uv@0.11.20";
const AwsCloudWatchMcpInstallDirectoryName = "aws-cloudwatch-mcp";
export const AwsCloudWatchMcpWrapperPath = "/usr/local/bin/aws-cloudwatch-mcp";
const AwsCloudWatchMcpExecutablePath = ".local/bin/awslabs.cloudwatch-mcp-server";
const AwsCloudWatchMcpConfigRelativePath = ".aws/config";
const AwsCloudWatchMcpCredentialsRelativePath = ".aws/credentials";
const AwsCloudWatchMcpRequiredServiceIds = ["cloudwatch", "logs"];
const ManagedProxyCaBundlePath = "/run/mistle/sandboxd/egress-proxy-ca-bundle.pem";
const ArtifactCommandTimeoutMs = 120_000;

function resolveAwsCloudWatchMcpArtifactDirectory(runtimeArtifactDir: string): string {
  return `${runtimeArtifactDir}/${AwsCloudWatchMcpInstallDirectoryName}`;
}

function renderInstallAwsCliScript(): string {
  return [
    `aws_cli_version=${JSON.stringify(AwsCliVersion)}`,
    `install_root=${JSON.stringify(AwsCliInstallRoot)}`,
    "",
    'case "$(uname -m)" in',
    "  x86_64 | amd64)",
    '    aws_cli_arch="x86_64"',
    "    ;;",
    "  aarch64 | arm64)",
    '    aws_cli_arch="aarch64"',
    "    ;;",
    "  *)",
    '    echo "Unsupported AWS CLI architecture: $(uname -m)" >&2',
    "    exit 1",
    "    ;;",
    "esac",
    'download_url="https://awscli.amazonaws.com/awscli-exe-linux-${aws_cli_arch}-${aws_cli_version}.zip"',
    "",
    'temp_dir="$(mktemp -d)"',
    "trap 'rm -rf \"$temp_dir\"' EXIT",
    "",
    'curl --noproxy "*" -fsSL "$download_url" -o "$temp_dir/awscliv2.zip"',
    'unzip -q "$temp_dir/awscliv2.zip" -d "$temp_dir"',
    'rm -rf "$install_root"',
    'mkdir -p "$temp_dir/bin"',
    '"$temp_dir/aws/install" --install-dir "$install_root" --bin-dir "$temp_dir/bin"',
  ].join("\n");
}

function createAwsCliArtifact(): CompileBindingResult["artifacts"][number] {
  return {
    artifactKey: AwsCliArtifactKey,
    name: AwsCliArtifactName,
    lifecycle: {
      install: ({ refs }) => [
        refs.command.exec({
          args: ["sh", "-euc", renderInstallAwsCliScript()],
          timeoutMs: ArtifactCommandTimeoutMs,
        }),
      ],
    },
  };
}

function renderInstallAwsCloudWatchMcpScript(input: { artifactDirectory: string }): string {
  const executablePath = `${input.artifactDirectory}/${AwsCloudWatchMcpExecutablePath}`;

  return [
    `artifact_dir=${JSON.stringify(input.artifactDirectory)}`,
    `package_spec=${JSON.stringify(AwsCloudWatchMcpPackage)}`,
    `python_command=${JSON.stringify(AwsCloudWatchMcpPythonCommand)}`,
    "",
    'rm -rf "$artifact_dir"',
    'mkdir -p "$artifact_dir"',
    `HOME="$artifact_dir" UV_CACHE_DIR="$artifact_dir/uv-cache" mise exec ${AwsCloudWatchMcpPythonTool} ${AwsCloudWatchMcpUvTool} -- uv tool install --force --python "$python_command" "$package_spec"`,
    `test -x ${JSON.stringify(executablePath)}`,
  ].join("\n");
}

function createAwsCloudWatchMcpArtifact(): CompileBindingResult["artifacts"][number] {
  return {
    artifactKey: AwsToolIds.AWS_CLOUDWATCH_MCP,
    name: AwsCloudWatchMcpArtifactName,
    lifecycle: {
      install: ({ refs }) => {
        const artifactDirectory = resolveAwsCloudWatchMcpArtifactDirectory(
          refs.sandboxPaths.runtimeArtifactDir,
        );

        return [
          refs.mise.install({
            tools: [AwsCloudWatchMcpPythonTool, AwsCloudWatchMcpUvTool],
            timeoutMs: ArtifactCommandTimeoutMs,
          }),
          refs.command.exec({
            args: [
              "sh",
              "-euc",
              renderInstallAwsCloudWatchMcpScript({
                artifactDirectory,
              }),
            ],
            timeoutMs: ArtifactCommandTimeoutMs,
          }),
        ];
      },
    },
  };
}

function renderAwsCliWrapperScript(): string {
  return ["#!/bin/sh", "set -eu", `exec ${AwsCliManagedBinaryPath} --no-sign-request "$@"`].join(
    "\n",
  );
}

function renderAwsCloudWatchMcpWrapperScript(input: {
  artifactDirectory: string;
  defaultRegion: string;
}): string {
  return [
    "#!/bin/sh",
    "set -eu",
    "",
    "unset AWS_PROFILE",
    "export AWS_ACCESS_KEY_ID=mistle-placeholder",
    "export AWS_SECRET_ACCESS_KEY=mistle-placeholder",
    `export AWS_REGION=${JSON.stringify(input.defaultRegion)}`,
    `export AWS_DEFAULT_REGION=${JSON.stringify(input.defaultRegion)}`,
    "export FASTMCP_LOG_LEVEL=ERROR",
    `export AWS_CA_BUNDLE=${JSON.stringify(ManagedProxyCaBundlePath)}`,
    `export SSL_CERT_FILE=${JSON.stringify(ManagedProxyCaBundlePath)}`,
    `export REQUESTS_CA_BUNDLE=${JSON.stringify(ManagedProxyCaBundlePath)}`,
    `export CURL_CA_BUNDLE=${JSON.stringify(ManagedProxyCaBundlePath)}`,
    `export AWS_CONFIG_FILE=${JSON.stringify(`${input.artifactDirectory}/${AwsCloudWatchMcpConfigRelativePath}`)}`,
    `export AWS_SHARED_CREDENTIALS_FILE=${JSON.stringify(`${input.artifactDirectory}/${AwsCloudWatchMcpCredentialsRelativePath}`)}`,
    `export HOME=${JSON.stringify(input.artifactDirectory)}`,
    `export UV_CACHE_DIR=${JSON.stringify(`${input.artifactDirectory}/uv-cache`)}`,
    "",
    `exec ${JSON.stringify(`${input.artifactDirectory}/${AwsCloudWatchMcpExecutablePath}`)} "$@"`,
  ].join("\n");
}

function renderAwsCloudWatchMcpConfig(input: { defaultRegion: string }): string {
  return ["[default]", `region = ${input.defaultRegion}`, "output = json", ""].join("\n");
}

function renderAwsCloudWatchMcpCredentials(): string {
  return [
    "[default]",
    "aws_access_key_id = mistle-placeholder",
    "aws_secret_access_key = mistle-placeholder",
    "",
  ].join("\n");
}

function renderAwsCliConfig(input: { defaultRegion: string }): string {
  return [
    "[default]",
    `region = ${input.defaultRegion}`,
    "output = json",
    "s3 =",
    "  addressing_style = path",
    "  use_accelerate_endpoint = false",
    "  use_dualstack_endpoint = false",
    "",
  ].join("\n");
}

function createAwsCliRuntimeClient(input: {
  defaultRegion: string;
}): CompileBindingResult["runtimeClients"][number] {
  return {
    clientId: AwsCliRuntimeClientId,
    setup: {
      env: {},
      files: [
        {
          fileId: AwsCliWrapperFileId,
          path: AwsCliWrapperPath,
          mode: 0o755,
          content: renderAwsCliWrapperScript(),
        },
        {
          fileId: AwsCliConfigFileId,
          path: AwsCliConfigPath,
          mode: 0o600,
          content: renderAwsCliConfig({
            defaultRegion: input.defaultRegion,
          }),
        },
      ],
    },
    processes: [],
    endpoints: [],
  };
}

function createAwsCloudWatchMcpRuntimeClient(input: {
  artifactDirectory: string;
  defaultRegion: string;
}): CompileBindingResult["runtimeClients"][number] {
  return {
    clientId: "aws-cloudwatch-mcp-runtime",
    setup: {
      env: {},
      files: [
        {
          fileId: "aws_cloudwatch_mcp_wrapper",
          path: AwsCloudWatchMcpWrapperPath,
          mode: 0o755,
          content: renderAwsCloudWatchMcpWrapperScript({
            artifactDirectory: input.artifactDirectory,
            defaultRegion: input.defaultRegion,
          }),
        },
        {
          fileId: "aws_cloudwatch_mcp_config",
          path: `${input.artifactDirectory}/${AwsCloudWatchMcpConfigRelativePath}`,
          mode: 0o600,
          content: renderAwsCloudWatchMcpConfig({
            defaultRegion: input.defaultRegion,
          }),
        },
        {
          fileId: "aws_cloudwatch_mcp_credentials",
          path: `${input.artifactDirectory}/${AwsCloudWatchMcpCredentialsRelativePath}`,
          mode: 0o600,
          content: renderAwsCloudWatchMcpCredentials(),
        },
      ],
    },
    processes: [],
    endpoints: [],
  };
}

function compareStrings(left: string, right: string): number {
  return left.localeCompare(right);
}

function buildAwsRegionalRoute(input: {
  host: string;
  upstreamBaseUrl: string;
  connectionId: string;
  service: string;
  region: string;
}): CompileBindingEgressRoute {
  return {
    match: {
      hosts: [input.host],
    },
    upstream: {
      baseUrl: input.upstreamBaseUrl,
    },
    authInjection: {
      type: "aws_sigv4",
      service: input.service,
      region: input.region,
    },
    credentialResolver: {
      kind: "integration_connection",
      connectionId: input.connectionId,
      secretType: AwsCredentialSecretTypes.AWS_SECRET_ACCESS_KEY,
      slotKey: AwsCredentialSlotKeys.SECRET_ACCESS_KEY,
      resolverKey: AwsCredentialResolverKeys.ASSUME_ROLE_SESSION,
    },
  };
}

function buildAwsEgressRoutes(input: {
  services: ReadonlyArray<string>;
  regions: ReadonlyArray<string>;
  connectionId: string;
}): ReadonlyArray<CompileBindingEgressRoute> {
  const routesByHost = new Map<string, CompileBindingEgressRoute>();

  for (const serviceId of input.services) {
    const serviceDefinition = resolveAwsEndpointServiceDefinition(serviceId);
    if (serviceDefinition === undefined) {
      throw new Error(`Unsupported AWS service id '${serviceId}'.`);
    }

    if (serviceDefinition.endpointKind !== "global") {
      for (const region of input.regions) {
        const host = renderAwsRegionalHostname({
          serviceId: serviceDefinition.signingName,
          region,
          ...(serviceDefinition.regionalHostnameTemplate === undefined
            ? {}
            : {
                regionalHostnameTemplate: serviceDefinition.regionalHostnameTemplate,
              }),
        });
        routesByHost.set(
          host,
          buildAwsRegionalRoute({
            host,
            upstreamBaseUrl: `https://${host}`,
            connectionId: input.connectionId,
            service: serviceDefinition.signingName,
            region,
          }),
        );
      }
    }

    if (
      serviceDefinition.endpointKind === "global" ||
      serviceDefinition.endpointKind === "regional_and_global"
    ) {
      if (
        serviceDefinition.globalHostname === undefined ||
        serviceDefinition.globalSigningRegion === undefined
      ) {
        throw new Error(`AWS service '${serviceId}' is missing global endpoint metadata.`);
      }

      routesByHost.set(
        serviceDefinition.globalHostname,
        buildAwsRegionalRoute({
          host: serviceDefinition.globalHostname,
          upstreamBaseUrl: `https://${serviceDefinition.globalHostname}`,
          connectionId: input.connectionId,
          service: serviceDefinition.signingName,
          region: serviceDefinition.globalSigningRegion,
        }),
      );
    }
  }

  return [...routesByHost.values()].sort((left, right) =>
    compareStrings(left.match.hosts[0] ?? "", right.match.hosts[0] ?? ""),
  );
}

function appendCloudWatchMcpRequiredServices(input: {
  services: ReadonlyArray<string>;
  includeCloudWatchMcp: boolean;
}): ReadonlyArray<string> {
  if (!input.includeCloudWatchMcp) {
    return input.services;
  }

  return [...new Set([...input.services, ...AwsCloudWatchMcpRequiredServiceIds])].sort(
    compareStrings,
  );
}

export function compileAwsBinding(input: AwsCompileBindingInput): CompileBindingResult {
  AwsAssumeRoleConnectionConfigSchema.parse(input.connection.config);

  const services = [...new Set(input.binding.config.services)].sort(compareStrings);
  const includesCloudWatchMcp = input.binding.config.tools.includes(AwsToolIds.AWS_CLOUDWATCH_MCP);
  const effectiveServices = appendCloudWatchMcpRequiredServices({
    services,
    includeCloudWatchMcp: includesCloudWatchMcp,
  });
  const regions = [...new Set(input.binding.config.regions)].sort(compareStrings);
  const includesAwsCli = input.binding.config.tools.includes(AwsToolIds.AWS_CLI);
  const cloudWatchMcpArtifactDirectory = resolveAwsCloudWatchMcpArtifactDirectory(
    input.refs.sandboxPaths.runtimeArtifactDir,
  );

  return {
    egressRoutes: buildAwsEgressRoutes({
      services: effectiveServices,
      regions,
      connectionId: input.connection.id,
    }),
    artifacts: [
      ...(includesAwsCli ? [createAwsCliArtifact()] : []),
      ...(includesCloudWatchMcp ? [createAwsCloudWatchMcpArtifact()] : []),
    ],
    runtimeClients: [
      ...(includesAwsCli
        ? [
            createAwsCliRuntimeClient({
              defaultRegion: input.binding.config.defaultRegion,
            }),
          ]
        : []),
      ...(includesCloudWatchMcp
        ? [
            createAwsCloudWatchMcpRuntimeClient({
              artifactDirectory: cloudWatchMcpArtifactDirectory,
              defaultRegion: input.binding.config.defaultRegion,
            }),
          ]
        : []),
    ],
  };
}
