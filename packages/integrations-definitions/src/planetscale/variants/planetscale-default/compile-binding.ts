import { type CompileBindingInput, type CompileBindingResult } from "@mistle/integrations-core";

import {
  resolvePlanetScaleCredentialSecretType,
  resolvePlanetScaleCredentialSlotKeys,
} from "./auth.js";
import type { PlanetScaleBindingConfig } from "./binding-config-schema.js";
import type { PlanetScaleTargetConfig } from "./target-config-schema.js";
import { PlanetScaleToolIds } from "./tool-ids.js";

export type PlanetScaleCompileBindingInput = CompileBindingInput<
  PlanetScaleTargetConfig,
  PlanetScaleBindingConfig
>;

const PlanetScaleApiBaseUrl = "https://api.planetscale.com";
const PlanetScaleApiHost = "api.planetscale.com";
const PlanetScaleMcpBaseUrl = "https://mcp.pscale.dev/mcp/planetscale";
const PlanetScaleInsightsMcpBaseUrl = "https://mcp.pscale.dev/mcp/planetscale-insights-only";
const PlanetScaleMcpHost = "mcp.pscale.dev";
const PlanetScaleCliArtifactKey = "planetscale-cli";
const PlanetScaleCliArtifactName = "PlanetScale CLI";
const PlanetScaleCliRepository = "planetscale/cli";
const PlanetScaleCliRuntimeClientId = "planetscale-cli-runtime";
const PlanetScaleCliWrapperFileId = "planetscale_cli_wrapper";
const ArtifactCommandTimeoutMs = 120_000;

function createPlanetScaleCredentialResolver(input: {
  familyId: string;
  variantId: string;
  connectionId: string;
  secretType: "oauth2_access_token";
}): CompileBindingResult["egressRoutes"][number]["credentialResolver"] {
  const slotKeys = resolvePlanetScaleCredentialSlotKeys({
    familyId: input.familyId,
    variantId: input.variantId,
  });

  return {
    connectionId: input.connectionId,
    secretType: input.secretType,
    slotKey: slotKeys.accessToken,
  };
}

function createPlanetScaleApiRoute(input: {
  familyId: string;
  variantId: string;
  connectionId: string;
  secretType: "oauth2_access_token";
}): CompileBindingResult["egressRoutes"][number] {
  return {
    match: {
      hosts: [PlanetScaleApiHost],
    },
    upstream: {
      baseUrl: PlanetScaleApiBaseUrl,
    },
    authInjection: {
      type: "bearer",
      target: "authorization",
    },
    credentialResolver: createPlanetScaleCredentialResolver(input),
  };
}

function createPlanetScaleMcpRoute(input: {
  familyId: string;
  variantId: string;
  connectionId: string;
  secretType: "oauth2_access_token";
  upstreamBaseUrl: string;
}): CompileBindingResult["egressRoutes"][number] {
  return {
    match: {
      hosts: [PlanetScaleMcpHost],
    },
    upstream: {
      baseUrl: input.upstreamBaseUrl,
    },
    authInjection: {
      type: "bearer",
      target: "authorization",
    },
    credentialResolver: createPlanetScaleCredentialResolver(input),
  };
}

function renderInstallPlanetScaleCliScript(installPath: string): string {
  return [
    'arch="$(uname -m)"',
    'case "$arch" in',
    "  x86_64)",
    '    asset_suffix="linux_amd64"',
    "    ;;",
    "  aarch64|arm64)",
    '    asset_suffix="linux_arm64"',
    "    ;;",
    "  *)",
    '    echo "Unsupported architecture: $arch" >&2',
    "    exit 1",
    "    ;;",
    "esac",
    "",
    `tag_name="$(curl --noproxy '*' -fsSI https://github.com/${PlanetScaleCliRepository}/releases/latest | tr -d '\\r' | sed -n 's/^[Ll]ocation: .*\\/tag\\/\\([^[:space:]]*\\)$/\\1/p' | tail -n1)"`,
    'if [ -z "$tag_name" ]; then',
    '  echo "Failed to resolve latest PlanetScale CLI release tag." >&2',
    "  exit 1",
    "fi",
    'version="${tag_name#v}"',
    'asset_name="pscale_${version}_${asset_suffix}.tar.gz"',
    `download_url="https://github.com/${PlanetScaleCliRepository}/releases/download/\${tag_name}/\${asset_name}"`,
    `install_path=${JSON.stringify(installPath)}`,
    "",
    'temp_dir="$(mktemp -d)"',
    "trap 'rm -rf \"$temp_dir\"' EXIT",
    "",
    'curl --noproxy "*" -fsSL "$download_url" -o "$temp_dir/pscale.tar.gz"',
    'tar -xzf "$temp_dir/pscale.tar.gz" -C "$temp_dir"',
    'install -m 0755 "$temp_dir/pscale" "$install_path"',
  ].join("\n");
}

function createPlanetScaleCliArtifact(): CompileBindingResult["artifacts"][number] {
  return {
    artifactKey: PlanetScaleCliArtifactKey,
    name: PlanetScaleCliArtifactName,
    lifecycle: {
      install: ({ refs }) => [
        refs.command.exec({
          args: [
            "sh",
            "-euc",
            renderInstallPlanetScaleCliScript(refs.artifactBinPath("pscale-managed")),
          ],
          timeoutMs: ArtifactCommandTimeoutMs,
        }),
      ],
    },
  };
}

function renderPlanetScaleCliWrapperScript(input: { managedCliBinaryPath: string }): string {
  return [
    "#!/bin/sh",
    "set -eu",
    `exec ${input.managedCliBinaryPath} --api-token mistle-managed-oauth "$@"`,
  ].join("\n");
}

function createPlanetScaleCliRuntimeClient(input: {
  managedCliBinaryPath: string;
  cliWrapperPath: string;
}): CompileBindingResult["runtimeClients"][number] {
  return {
    clientId: PlanetScaleCliRuntimeClientId,
    setup: {
      env: {},
      files: [
        {
          fileId: PlanetScaleCliWrapperFileId,
          path: input.cliWrapperPath,
          mode: 0o755,
          content: renderPlanetScaleCliWrapperScript({
            managedCliBinaryPath: input.managedCliBinaryPath,
          }),
        },
      ],
    },
    processes: [],
    endpoints: [],
  };
}

export function compilePlanetScaleBinding(
  input: PlanetScaleCompileBindingInput,
): CompileBindingResult {
  const credentialSecretType = resolvePlanetScaleCredentialSecretType(input.connection.config);
  const managedCliBinaryPath = input.refs.artifactBinPath("pscale-managed");
  const cliWrapperPath = `${input.refs.sandboxPaths.runtimeArtifactBinDir}/pscale`;
  const includesPlanetScaleCli = input.binding.config.tools.includes(
    PlanetScaleToolIds.PLANETSCALE_CLI,
  );
  const includesPlanetScaleMcp = input.binding.config.tools.includes(
    PlanetScaleToolIds.PLANETSCALE_MCP,
  );
  const includesPlanetScaleInsightsMcp = input.binding.config.tools.includes(
    PlanetScaleToolIds.PLANETSCALE_INSIGHTS_MCP,
  );

  return {
    egressRoutes: [
      createPlanetScaleApiRoute({
        familyId: input.target.familyId,
        variantId: input.target.variantId,
        connectionId: input.connection.id,
        secretType: credentialSecretType,
      }),
      ...(includesPlanetScaleMcp
        ? [
            createPlanetScaleMcpRoute({
              familyId: input.target.familyId,
              variantId: input.target.variantId,
              connectionId: input.connection.id,
              secretType: credentialSecretType,
              upstreamBaseUrl: PlanetScaleMcpBaseUrl,
            }),
          ]
        : []),
      ...(includesPlanetScaleInsightsMcp
        ? [
            createPlanetScaleMcpRoute({
              familyId: input.target.familyId,
              variantId: input.target.variantId,
              connectionId: input.connection.id,
              secretType: credentialSecretType,
              upstreamBaseUrl: PlanetScaleInsightsMcpBaseUrl,
            }),
          ]
        : []),
    ],
    artifacts: includesPlanetScaleCli ? [createPlanetScaleCliArtifact()] : [],
    runtimeClients: includesPlanetScaleCli
      ? [
          createPlanetScaleCliRuntimeClient({
            managedCliBinaryPath,
            cliWrapperPath,
          }),
        ]
      : [],
  };
}
