import type {
  CompileBindingInput,
  CompileBindingResult,
  RuntimeExecCommand,
} from "@mistle/integrations-core";

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
const TensorlakeCliVersion = "0.5.31";
const TensorlakeCliPlaceholderApiKey = "tl_apiKey_mistle_placeholder_for_managed_egress";
const TensorlakeCliNodeTool = "node@24.11.1";
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

function renderInstallTensorlakeCliScript(input: {
  installPath: string;
  packageInstallDir: string;
}): string {
  return [
    'package_spec="tensorlake@' + TensorlakeCliVersion + '"',
    "install_path=" + JSON.stringify(input.installPath),
    "package_install_dir=" + JSON.stringify(input.packageInstallDir),
    'mkdir -p "$package_install_dir"',
    'npm install --prefix "$package_install_dir" --omit=dev --ignore-scripts --no-audit --no-fund "$package_spec"',
    'ln -sf "$package_install_dir/node_modules/.bin/tensorlake" "$install_path"',
    'chmod 0755 "$install_path"',
  ].join("\n");
}

function createTensorlakeCliInstallCommand(input: {
  installPath: string;
  packageInstallDir: string;
}): RuntimeExecCommand {
  return {
    args: [
      "mise",
      "exec",
      TensorlakeCliNodeTool,
      "--",
      "sh",
      "-euc",
      renderInstallTensorlakeCliScript(input),
    ],
    timeoutMs: ArtifactCommandTimeoutMs,
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
        refs.mise.install({
          tools: [TensorlakeCliNodeTool],
          timeoutMs: ArtifactCommandTimeoutMs,
        }),
        refs.command.exec(
          createTensorlakeCliInstallCommand({
            installPath: refs.artifactBinPath("tensorlake"),
            packageInstallDir: `${refs.sandboxPaths.runtimeArtifactDir}/${TensorlakeCliArtifactKey}`,
          }),
        ),
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
