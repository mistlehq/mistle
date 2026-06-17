import type { CompileBindingInput, CompileBindingResult } from "@mistle/integrations-core";

import {
  TensorlakeSandboxRuntimeCredentialSecretTypes,
  TensorlakeSandboxRuntimeCredentialSlotKeys,
  TensorlakeToolIds,
} from "./constants.js";
import type { TensorlakeSandboxRuntimeBindingConfig } from "./schemas.js";

type TensorlakeCompileBindingInput = CompileBindingInput<
  Record<string, never>,
  TensorlakeSandboxRuntimeBindingConfig
>;
type TensorlakeCompiledRoute = NonNullable<CompileBindingResult["egressRoutes"][number]>;

const TensorlakeApiHost = "api.tensorlake.ai";
const TensorlakeSandboxHost = "sandbox.tensorlake.ai";
const TensorlakeApiBaseUrl = `https://${TensorlakeApiHost}`;
const TensorlakeSandboxBaseUrl = `https://${TensorlakeSandboxHost}`;
const TensorlakeCliArtifactKey = "tensorlake-cli";
const TensorlakeCliArtifactName = "Tensorlake CLI";
const TensorlakeGitHubRepository = "tensorlakeai/tensorlake";
const TensorlakeCliReleaseTag = "cli-v0.5.47";
const TensorlakeCliPlaceholderApiKey = "tl_apiKey_mistle_placeholder_for_managed_egress";
const ArtifactCommandTimeoutMs = 180_000;

function createCredentialResolver(
  input: TensorlakeCompileBindingInput,
): TensorlakeCompiledRoute["credentialResolver"] {
  return {
    kind: "integration_connection",
    connectionId: input.connection.id,
    secretType: TensorlakeSandboxRuntimeCredentialSecretTypes.API_KEY,
    slotKey: TensorlakeSandboxRuntimeCredentialSlotKeys.API_KEY,
  };
}

function createTensorlakeEgressRoutes(
  input: TensorlakeCompileBindingInput,
): CompileBindingResult["egressRoutes"] {
  const credentialResolver = createCredentialResolver(input);

  return [
    {
      match: {
        hosts: [TensorlakeApiHost],
        pathPrefixes: ["/"],
      },
      upstream: {
        baseUrl: TensorlakeApiBaseUrl,
      },
      authInjection: {
        type: "bearer",
        target: "authorization",
      },
      credentialResolver,
    },
    {
      match: {
        hosts: [TensorlakeSandboxHost],
        pathPrefixes: ["/"],
      },
      upstream: {
        baseUrl: TensorlakeSandboxBaseUrl,
      },
      authInjection: {
        type: "bearer",
        target: "authorization",
      },
      credentialResolver,
    },
  ];
}

function createTensorlakeCliArtifact(): CompileBindingResult["artifacts"][number] {
  return {
    artifactKey: TensorlakeCliArtifactKey,
    name: TensorlakeCliArtifactName,
    env: {
      TENSORLAKE_API_KEY: TensorlakeCliPlaceholderApiKey,
      TENSORLAKE_API_URL: TensorlakeApiBaseUrl,
      TENSORLAKE_SANDBOX_PROXY_URL: TensorlakeSandboxBaseUrl,
    },
    lifecycle: {
      install: ({ refs }) => [
        refs.githubReleases.install({
          repository: TensorlakeGitHubRepository,
          release: {
            kind: "tag",
            match: "exact",
            tag: TensorlakeCliReleaseTag,
          },
          asset: {
            kind: "by_arch",
            x86_64: {
              fileName: "tensorlake-cli-linux-x86_64.tar.gz",
              format: "tar.gz",
              extractedPath: "tensorlake",
              sha256: "9c02b09a94d6c1e592a8e6c43b5ce90273268585593ca492890db6d8afa77a49",
            },
            aarch64: {
              fileName: "tensorlake-cli-linux-aarch64.tar.gz",
              format: "tar.gz",
              extractedPath: "tensorlake",
              sha256: "443bce4b2d831298b7d784e8c5f1f326f92506fa188d3d3332c8537ab3afddfb",
            },
          },
          installPath: refs.artifactBinPath("tensorlake"),
          timeoutMs: ArtifactCommandTimeoutMs,
        }),
      ],
    },
  };
}

export function compileTensorlakeBinding(
  input: TensorlakeCompileBindingInput,
): CompileBindingResult {
  const includesTensorlakeCli = input.binding.config.tools.includes(
    TensorlakeToolIds.TENSORLAKE_CLI,
  );

  return {
    egressRoutes: includesTensorlakeCli ? createTensorlakeEgressRoutes(input) : [],
    artifacts: includesTensorlakeCli ? [createTensorlakeCliArtifact()] : [],
    runtimeClients: [],
  };
}
