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
const AwsCliBundleUrl = `https://awscli.amazonaws.com/awscli-exe-linux-x86_64-${AwsCliVersion}.zip`;
const AwsCliInstallRoot = "/usr/local/aws-cli-mistle";
const AwsCliManagedBinaryPath = `${AwsCliInstallRoot}/v2/current/bin/aws`;
const AwsCliWrapperPath = "/usr/local/bin/aws";
const AwsCliRuntimeClientId = "aws-cli-runtime";
const AwsCliWrapperFileId = "aws_wrapper";
const AwsCliConfigFileId = "aws_config";
const AwsCliConfigPath = "/root/.aws/config";
const ArtifactCommandTimeoutMs = 120_000;

function renderInstallAwsCliScript(): string {
  return [
    `download_url=${JSON.stringify(AwsCliBundleUrl)}`,
    `install_root=${JSON.stringify(AwsCliInstallRoot)}`,
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

function renderAwsCliWrapperScript(): string {
  return ["#!/bin/sh", "set -eu", `exec ${AwsCliManagedBinaryPath} --no-sign-request "$@"`].join(
    "\n",
  );
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

export function compileAwsBinding(input: AwsCompileBindingInput): CompileBindingResult {
  AwsAssumeRoleConnectionConfigSchema.parse(input.connection.config);

  const services = [...new Set(input.binding.config.services)].sort(compareStrings);
  const regions = [...new Set(input.binding.config.regions)].sort(compareStrings);
  const includesAwsCli = input.binding.config.tools.includes(AwsToolIds.AWS_CLI);

  return {
    egressRoutes: buildAwsEgressRoutes({
      services,
      regions,
      connectionId: input.connection.id,
    }),
    artifacts: includesAwsCli ? [createAwsCliArtifact()] : [],
    runtimeClients: includesAwsCli
      ? [
          createAwsCliRuntimeClient({
            defaultRegion: input.binding.config.defaultRegion,
          }),
        ]
      : [],
  };
}
