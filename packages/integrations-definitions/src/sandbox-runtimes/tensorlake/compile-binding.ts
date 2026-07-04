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
const TensorlakeApiBaseUrl = `https://${TensorlakeApiHost}`;
const TensorlakeCliArtifactKey = "tensorlake-cli";
const TensorlakeCliArtifactName = "Tensorlake CLI";
const TensorlakeGitHubRepository = "tensorlakeai/tensorlake";
const TensorlakeCliReleaseTag = "cli-v0.5.58";
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
  ];
}

function createTensorlakeCliArtifact(): CompileBindingResult["artifacts"][number] {
  return {
    artifactKey: TensorlakeCliArtifactKey,
    name: TensorlakeCliArtifactName,
    env: {
      TENSORLAKE_API_KEY: TensorlakeCliPlaceholderApiKey,
      TENSORLAKE_API_URL: TensorlakeApiBaseUrl,
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
              sha256: "36ab3effbbb05535401f7d4efd71d97b721c25662840d8956f1a69a01d762358",
            },
            aarch64: {
              fileName: "tensorlake-cli-linux-aarch64.tar.gz",
              format: "tar.gz",
              extractedPath: "tensorlake",
              sha256: "dd73264282444698c47b0a134e723e54447d782821737e0191c5189b57117546",
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
