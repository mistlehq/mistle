import {
  CompiledRuntimePlanSchema,
  type EgressCredentialRoute,
  IntegrationMcpConfigFormats,
  IntegrationMcpTransports,
  type ResolvedIntegrationMcpServer,
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
import { createDesignerRuntimeReferenceSetupFiles } from "./designer-runtime-reference-files.js";

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

export type DesignerRuntimeMistleMcpConfig =
  | {
      enabled: false;
    }
  | {
      enabled: true;
      url: string;
    };

export type DesignerRuntimeLangfuseConfig =
  | {
      enabled: false;
    }
  | {
      enabled: true;
      publicKey: string;
      baseUrl: string;
      environment?: string;
      metadata: Readonly<Record<string, string>>;
      tags?: ReadonlyArray<string>;
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
  langfuse?: DesignerRuntimeLangfuseConfig;
  mistleMcp: DesignerRuntimeMistleMcpConfig;
  openAiProviderMode?: "platform" | "local_subscription";
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
    ...(input.langfuse?.enabled === true
      ? [createDesignerLangfuseEgressRoute(input.langfuse)]
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
    ...(input.langfuse?.enabled === true
      ? {
          langfuseTracing: {
            publicKey: input.langfuse.publicKey,
            secretKeyPlaceholder: "mistle-managed-egress",
            baseUrl: input.langfuse.baseUrl,
            ...(input.langfuse.environment === undefined
              ? {}
              : { environment: input.langfuse.environment }),
            metadata: input.langfuse.metadata,
            ...(input.langfuse.tags === undefined ? {} : { tags: input.langfuse.tags }),
          },
        }
      : {}),
  });
  if ((codexRuntime.artifacts ?? []).length > 0) {
    throw new Error("Designer installed Codex runtime must not require runtime artifacts.");
  }
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
            files: [...runtimeClient.setup.files, ...createDesignerRuntimeReferenceSetupFiles()],
          },
        }
      : runtimeClient,
  );
  return CompiledRuntimePlanSchema.parse({
    sandboxProfileId: DESIGNER_RUNTIME_PROFILE_ID,
    version: DESIGNER_RUNTIME_PROFILE_VERSION,
    image: {
      source: SandboxImageSources.BASE,
      imageRef: input.imageRef,
    },
    associatedResourceEventRouting: createDisabledAssociatedResourceEventRouting(),
    egressRoutes,
    artifacts: [],
    workspaceSources: [],
    runtimeClients: runtimeClientsWithDesignerReferences,
    agentRuntimes: codexRuntime.agentRuntimes,
  });
}

function createDesignerLangfuseEgressRoute(
  langfuse: Extract<DesignerRuntimeLangfuseConfig, { enabled: true }>,
): EgressCredentialRoute {
  const baseUrl = new URL(langfuse.baseUrl);

  return {
    egressRuleId: "egress_rule_designer_langfuse_traces",
    bindingId: "designer-langfuse",
    familyId: "langfuse",
    variantId: "langfuse-otel",
    match: {
      hosts: [baseUrl.hostname],
      pathPrefixes: ["/api/public/otel/v1/traces"],
      methods: ["POST"],
    },
    upstream: {
      baseUrl: langfuse.baseUrl,
    },
    authInjection: {
      type: "basic",
      target: "authorization",
      username: langfuse.publicKey,
    },
    additionalHeaders: {
      "x-langfuse-public-key": langfuse.publicKey,
    },
    credentialResolver: {
      kind: "platform_langfuse_secret_key",
    },
  };
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
