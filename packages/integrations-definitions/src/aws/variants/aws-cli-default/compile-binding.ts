import type {
  CompileBindingInput,
  CompileBindingResult,
  RuntimeArtifactCommand,
  RuntimeArtifactSpec,
} from "@mistle/integrations-core";

import { AwsAssumeRoleConnectionConfigSchema } from "../../shared/auth.js";
import {
  AwsBindingConfigSchema,
  type AwsBindingConfig,
} from "../../shared/binding-config-schema.js";
import {
  AwsCliArtifactKey,
  AwsCliArtifactName,
  AwsCliBootstrapClientId,
  AwsCliConfigPath,
  AwsCliInstallDir,
  AwsCliManagedBinaryPath,
  AwsCliWrapperPath,
} from "../../shared/constants.js";
import { AwsCredentialResolverKeys } from "../../shared/credential-resolver.js";
import {
  AwsDnsSuffix,
  AwsEndpointMetadataByServiceId,
  type AwsServiceEndpointMetadata,
} from "../../shared/endpoint-catalog.js";

export type AwsCompileBindingInput = CompileBindingInput<Record<string, never>, AwsBindingConfig>;

const AwsApiMethods = ["DELETE", "GET", "HEAD", "PATCH", "POST", "PUT"];
const AwsCliPinnedVersion = "2.34.20";
const AwsCliPinnedBundleUrl = `https://awscli.amazonaws.com/awscli-exe-linux-x86_64-${AwsCliPinnedVersion}.zip`;
const ArtifactCommandTimeoutMs = 120_000;

type AwsCompiledRoute = CompileBindingResult["egressRoutes"][number];
type AwsResolvedEndpoint = {
  hostname: string;
  signingRegion: string;
};

function resolveAwsEndpointMetadata(serviceId: string): AwsServiceEndpointMetadata | undefined {
  return AwsEndpointMetadataByServiceId[serviceId];
}

function toRegionalHostname(input: { serviceId: string; regionId: string }): string {
  return `${input.serviceId}.${input.regionId}.${AwsDnsSuffix}`;
}

function resolveServiceEndpoints(input: {
  serviceId: string;
  regions: ReadonlyArray<string>;
}): ReadonlyArray<AwsResolvedEndpoint> {
  const metadata = resolveAwsEndpointMetadata(input.serviceId);
  const endpoints: AwsResolvedEndpoint[] = [];

  if (metadata?.regionalized !== false) {
    for (const regionId of input.regions) {
      endpoints.push({
        hostname: toRegionalHostname({
          serviceId: input.serviceId,
          regionId,
        }),
        signingRegion: regionId,
      });
    }
  }

  if (metadata?.hostname === undefined) {
    return endpoints;
  }

  endpoints.push({
    hostname: metadata.hostname,
    signingRegion: metadata.signingRegion ?? input.regions[0] ?? "us-east-1",
  });

  return endpoints;
}

function buildAwsRoute(input: {
  hostname: string;
  serviceId: string;
  signingRegion: string;
  connectionId: string;
}): AwsCompiledRoute {
  return {
    match: {
      hosts: [input.hostname],
      pathPrefixes: ["/"],
      methods: AwsApiMethods,
    },
    upstream: {
      baseUrl: `https://${input.hostname}`,
    },
    authInjection: {
      type: "aws_sigv4",
      service: input.serviceId,
      region: input.signingRegion,
    },
    credentialResolver: {
      connectionId: input.connectionId,
      secretType: "aws_secret_access_key",
      purpose: "aws_secret_access_key",
      resolverKey: AwsCredentialResolverKeys.ASSUME_ROLE_SESSION,
    },
  };
}

function renderAwsWrapperScript(): string {
  return [
    "#!/bin/sh",
    "set -eu",
    `exec ${JSON.stringify(AwsCliManagedBinaryPath)} --no-sign-request "$@"`,
  ].join("\n");
}

function renderAwsConfig(input: { defaultRegion: string }): string {
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

function renderInstallAwsCliScript(): string {
  return [
    `bundle_url=${JSON.stringify(AwsCliPinnedBundleUrl)}`,
    `install_dir=${JSON.stringify(AwsCliInstallDir)}`,
    "",
    'temp_dir="$(mktemp -d)"',
    "trap 'rm -rf \"$temp_dir\"' EXIT",
    "",
    'curl --noproxy "*" -fsSL "$bundle_url" -o "$temp_dir/awscliv2.zip"',
    'unzip -q "$temp_dir/awscliv2.zip" -d "$temp_dir"',
    'mkdir -p "$temp_dir/bin"',
    'rm -rf "$install_dir"',
    '"$temp_dir/aws/install" \\',
    '  --install-dir "$install_dir" \\',
    '  --bin-dir "$temp_dir/bin"',
  ].join("\n");
}

function buildAwsCliLifecycleCommand(): RuntimeArtifactCommand {
  return {
    args: ["sh", "-euc", renderInstallAwsCliScript()],
    timeoutMs: ArtifactCommandTimeoutMs,
  };
}

function buildAwsCliArtifact(): RuntimeArtifactSpec {
  return {
    artifactKey: AwsCliArtifactKey,
    name: AwsCliArtifactName,
    lifecycle: {
      install: [buildAwsCliLifecycleCommand()],
    },
  };
}

function sortBindingEntries(entries: ReadonlyArray<string>): ReadonlyArray<string> {
  return [...new Set(entries)].sort((left, right) => left.localeCompare(right));
}

export function compileAwsCliDefaultBinding(input: AwsCompileBindingInput): CompileBindingResult {
  AwsAssumeRoleConnectionConfigSchema.parse(input.connection.config);
  const parsedBindingConfig = AwsBindingConfigSchema.parse(input.binding.config);
  const services = sortBindingEntries(parsedBindingConfig.services);
  const regions = sortBindingEntries(parsedBindingConfig.regions);

  const routes: AwsCompiledRoute[] = [];
  for (const serviceId of services) {
    const serviceEndpoints = resolveServiceEndpoints({
      serviceId,
      regions,
    });

    for (const endpoint of serviceEndpoints) {
      routes.push(
        buildAwsRoute({
          hostname: endpoint.hostname,
          serviceId,
          signingRegion: endpoint.signingRegion,
          connectionId: input.connection.id,
        }),
      );
    }
  }

  routes.sort((left, right) => {
    const leftHost = left.match.hosts[0] ?? "";
    const rightHost = right.match.hosts[0] ?? "";
    return leftHost.localeCompare(rightHost);
  });

  return {
    egressRoutes: routes,
    artifacts: [buildAwsCliArtifact()],
    runtimeClients: [
      {
        clientId: AwsCliBootstrapClientId,
        setup: {
          env: {},
          files: [
            {
              fileId: "aws_wrapper",
              path: AwsCliWrapperPath,
              mode: 0o755,
              content: renderAwsWrapperScript(),
            },
            {
              fileId: "aws_config",
              path: AwsCliConfigPath,
              mode: 0o600,
              content: renderAwsConfig({
                defaultRegion: parsedBindingConfig.defaultRegion,
              }),
            },
          ],
        },
        processes: [],
        endpoints: [],
      },
    ],
  };
}
