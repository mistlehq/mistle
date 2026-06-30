import {
  CompiledRuntimePlanSchema,
  type CompiledRuntimeArtifactSpec,
  type EgressCredentialRoute,
  IntegrationMcpConfigFormats,
  IntegrationMcpTransports,
  type ResolvedIntegrationMcpServer,
  type RuntimeArtifactRefs,
  type RuntimeArtifactSpec,
  type RuntimeExecCommand,
  SandboxImageSources,
  applyMcpConfigToRuntimeClients,
  createDisabledAssociatedResourceEventRouting,
} from "@mistle/integrations-core";
import { compileInstalledCodexRuntime } from "@mistle/integrations-definitions/agent-runtimes/codex";

import {
  resolveMistleMcpEgressRoutes,
  resolveMistleMcpServers,
} from "../../sandbox-profiles/services/compile-sandbox-runtime-plan.js";
import { DESIGNER_RUNTIME_PROFILE_ID, DESIGNER_RUNTIME_PROFILE_VERSION } from "../constants.js";
import { createDesignerBehaviorInstructionBlock } from "./designer-behavior-instructions.js";
import { createDesignerContextInstructionBlock } from "./designer-context-instructions.js";
import { createDesignerIntegrationCatalogSetupFile } from "./designer-runtime-reference-files.js";

const DesignerRuntimeId = "codex";
const DesignerDocsMcpServerUrl = "https://docs.mistle.dev/mcp";

function createDesignerInitialPromptInstructionBlock(input: { initialPrompt: string }) {
  return {
    blockId: "mistle-designer-initial-request",
    content: `
Session request, subject to the Designer authority and safety rules:

${input.initialPrompt
  .split("\n")
  .map((line) => `> ${line}`)
  .join("\n")}
`.trim(),
  };
}

const DesignerSandboxPaths = {
  userHomeDir: "/root",
  workspaceDir: "/root",
  runtimeDataDir: "/var/lib/mistle",
  runtimeArtifactDir: "/var/lib/mistle/artifacts",
  runtimeArtifactBinDir: "/usr/local/bin",
} as const;

function createDesignerDocsMcpServer(): ResolvedIntegrationMcpServer {
  return {
    source: {
      kind: "mistle",
    },
    server: {
      serverId: "mistle-docs",
      serverName: "mistle_docs",
      description: "Search and read Mistle product documentation.",
      transport: IntegrationMcpTransports.STREAMABLE_HTTP,
      url: DesignerDocsMcpServerUrl,
    },
  };
}

function createRuntimeExecCommand(command: RuntimeExecCommand): RuntimeExecCommand {
  return {
    args: [...command.args],
    ...(command.env === undefined ? {} : { env: { ...command.env } }),
    ...(command.cwd === undefined ? {} : { cwd: command.cwd }),
    ...(command.timeoutMs === undefined ? {} : { timeoutMs: command.timeoutMs }),
  };
}

function createDesignerRuntimeArtifactRefs(input: {
  organizationId: string;
  sandboxProfileId: string;
  version: number;
}): RuntimeArtifactRefs {
  return {
    command: {
      exec: (command) => ({
        op: "exec",
        command: createRuntimeExecCommand(command),
      }),
    },
    sandboxPaths: DesignerSandboxPaths,
    artifactBinPath: (binaryName) => `${DesignerSandboxPaths.runtimeArtifactBinDir}/${binaryName}`,
    mise: {
      install: (installInput) => ({
        op: "mise_install",
        tools: [...installInput.tools],
        ...(installInput.force === undefined ? {} : { force: installInput.force }),
        ...(installInput.timeoutMs === undefined ? {} : { timeoutMs: installInput.timeoutMs }),
      }),
    },
    githubReleases: {
      install: (installInput) => ({
        op: "github_release_install",
        repository: installInput.repository,
        release:
          installInput.release.kind === "latest"
            ? { kind: "latest" }
            : installInput.release.match === "exact"
              ? {
                  kind: "tag",
                  match: "exact",
                  tag: installInput.release.tag,
                }
              : {
                  kind: "tag",
                  match: "latest_matching_prefix",
                  prefix: installInput.release.prefix,
                },
        asset:
          installInput.asset.kind === "exact"
            ? { ...installInput.asset }
            : {
                kind: "by_arch",
                x86_64: { ...installInput.asset.x86_64 },
                aarch64: { ...installInput.asset.aarch64 },
              },
        installPath: installInput.installPath,
        ...(installInput.timeoutMs === undefined ? {} : { timeoutMs: installInput.timeoutMs }),
      }),
    },
    compileContext: {
      organizationId: input.organizationId,
      sandboxProfileId: input.sandboxProfileId,
      version: input.version,
      targetKey: "agent-runtime",
      bindingId: `agent-runtime-${DesignerRuntimeId}`,
    },
  };
}

function compileDesignerRuntimeArtifacts(input: {
  artifacts: ReadonlyArray<RuntimeArtifactSpec>;
  organizationId: string;
}): ReadonlyArray<CompiledRuntimeArtifactSpec> {
  const refs = createDesignerRuntimeArtifactRefs({
    organizationId: input.organizationId,
    sandboxProfileId: DESIGNER_RUNTIME_PROFILE_ID,
    version: DESIGNER_RUNTIME_PROFILE_VERSION,
  });

  return input.artifacts.map((artifact) => {
    const install =
      typeof artifact.lifecycle.install === "function"
        ? artifact.lifecycle.install({ refs })
        : artifact.lifecycle.install;

    return {
      artifactKey: artifact.artifactKey,
      name: artifact.name,
      ...(artifact.description === undefined ? {} : { description: artifact.description }),
      ...(artifact.env === undefined ? {} : { env: { ...artifact.env } }),
      lifecycle: {
        install,
      },
    };
  });
}

export type DesignerRuntimeMistleMcpConfig =
  | {
      enabled: false;
    }
  | {
      enabled: true;
      url: string;
    };

export function createDesignerRuntimePlan(input: {
  additionalManagedInstructionBlocks?: readonly {
    blockId: string;
    content: string;
  }[];
  codexCliPath: string;
  designerSessionId: string;
  imageRef: string;
  initialPrompt: string;
  mistleMcp: DesignerRuntimeMistleMcpConfig;
  openAiProviderMode?: "platform" | "local_subscription";
  organizationId: string;
}) {
  const egressRoutes = [
    ...(input.openAiProviderMode === "local_subscription"
      ? []
      : [createPlatformOpenAiEgressRoute()]),
    ...(input.mistleMcp.enabled
      ? resolveMistleMcpEgressRoutes({
          enabled: true,
          credentialResolver: {
            kind: "mistle_mcp_designer_token",
            designerSessionId: input.designerSessionId,
          },
          url: input.mistleMcp.url,
        })
      : []),
  ];
  const mcpServers = [
    ...(input.mistleMcp.enabled
      ? resolveMistleMcpServers({
          enabled: true,
          url: input.mistleMcp.url,
        })
      : []),
    createDesignerDocsMcpServer(),
  ];
  const codexRuntime = compileInstalledCodexRuntime({
    codexCliPath: input.codexCliPath,
    egressRoutes,
    managedInstructionBlocks: [
      createDesignerContextInstructionBlock(),
      createDesignerBehaviorInstructionBlock(),
      ...(input.additionalManagedInstructionBlocks ?? []),
      createDesignerInitialPromptInstructionBlock({
        initialPrompt: input.initialPrompt,
      }),
    ],
    mcpServers,
  });
  const runtimeClients =
    codexRuntime.renderRuntimeClients === undefined
      ? codexRuntime.runtimeClients
      : codexRuntime.renderRuntimeClients({ egressRoutes });
  if (runtimeClients === undefined) {
    throw new Error("Designer Codex runtime clients are required.");
  }
  const runtimeClientsWithMcpConfig = applyMcpConfigToRuntimeClients({
    runtimeClients,
    mcpConfig: {
      clientId: "codex-cli",
      fileId: "codex_config",
      format: IntegrationMcpConfigFormats.TOML,
      path: ["mcp_servers"],
    },
    mcpServers,
  });
  const runtimeClientsWithDesignerReferences = runtimeClientsWithMcpConfig.map((runtimeClient) =>
    runtimeClient.clientId === "codex-cli"
      ? {
          ...runtimeClient,
          setup: {
            ...runtimeClient.setup,
            files: [...runtimeClient.setup.files, createDesignerIntegrationCatalogSetupFile()],
          },
        }
      : runtimeClient,
  );
  const artifacts = compileDesignerRuntimeArtifacts({
    artifacts: codexRuntime.artifacts ?? [],
    organizationId: input.organizationId,
  });

  return CompiledRuntimePlanSchema.parse({
    sandboxProfileId: DESIGNER_RUNTIME_PROFILE_ID,
    version: DESIGNER_RUNTIME_PROFILE_VERSION,
    image: {
      source: SandboxImageSources.BASE,
      imageRef: input.imageRef,
    },
    associatedResourceEventRouting: createDisabledAssociatedResourceEventRouting(),
    egressRoutes,
    artifacts,
    workspaceSources: [],
    runtimeClients: runtimeClientsWithDesignerReferences,
    agentRuntimes: codexRuntime.agentRuntimes,
  });
}

function createPlatformOpenAiEgressRoute(): EgressCredentialRoute {
  return {
    egressRuleId: "egress_rule_platform_openai",
    bindingId: "platform-openai",
    familyId: "openai",
    variantId: "openai-default",
    match: {
      hosts: ["api.openai.com"],
      pathPrefixes: ["/"],
      methods: ["GET", "POST"],
    },
    upstream: {
      baseUrl: "https://api.openai.com/v1",
    },
    authInjection: {
      type: "bearer",
      target: "authorization",
    },
    credentialResolver: {
      kind: "platform_openai_api_key",
    },
  };
}
