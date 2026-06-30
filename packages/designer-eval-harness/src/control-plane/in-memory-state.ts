import type { DesignerSessionResponse } from "@mistle/control-plane-api/designer";

import type {
  DesignerEvalCase,
  DesignerEvalProductState,
  DesignerEvalSeed,
  DesignerEvalSeedProviderConnection,
  DesignerEvalSeedProviderResource,
  DesignerEvalSeededState,
} from "../types.ts";

export type DesignerEvalSessionState = {
  availableProviderResources: readonly DesignerEvalSeedProviderResource[];
  designerSession: DesignerSessionResponse;
  productState: DesignerEvalProductState;
  seededState: DesignerEvalSeededState;
};

export function createDesignerEvalSessionState(input: {
  evalCase: DesignerEvalCase;
  runKey: string;
}): DesignerEvalSessionState {
  const organizationId = `org_eval_${input.runKey}`;
  const designerSessionId = `dsn_eval_${input.runKey}`;
  const sandboxInstanceId = `sbi_eval_${input.runKey}`;
  const seededState = createSeededState({
    runKey: input.runKey,
    seed: input.evalCase.seed,
  });
  const now = new Date().toISOString();

  return {
    seededState,
    availableProviderResources: createSeededProviderResources(input.evalCase.seed),
    designerSession: {
      id: designerSessionId,
      organizationId,
      sandboxInstanceId,
      sandboxProfileId: seededState.targetDraft.profileId,
      sandboxProfileVersion: seededState.targetDraft.version,
      title: null,
      status: "running",
      connectable: true,
      failureCode: null,
      failureMessage: null,
      runtimeContext: {
        agentRuntimeId: "codex",
        launchCwd: null,
        primaryRepositoryRoot: null,
      },
      startupOperation: null,
      initialPrompt: input.evalCase.prompt,
      canvasTabs: [],
      createdAt: now,
      updatedAt: now,
    },
    productState: {
      providerConnections: seededState.providerConnections,
      availableProviderResources: createSeededProviderResources(input.evalCase.seed),
      targetDraft: {
        profileId: seededState.targetDraft.profileId,
        version: seededState.targetDraft.version,
        integrationBindings:
          input.evalCase.seed.targetDraft.initialIntegrationBindings === undefined
            ? [
                {
                  id: `ibd_eval_${input.runKey}_agent`,
                  connectionId: `icn_eval_${input.runKey}_agent`,
                  kind: "agent",
                  config: {},
                },
              ]
            : [...input.evalCase.seed.targetDraft.initialIntegrationBindings],
      },
    },
  };
}

export function readDesignerEvalProductState(input: {
  state: DesignerEvalSessionState;
}): DesignerEvalProductState {
  return structuredClone(input.state.productState);
}

function createSeededState(input: {
  runKey: string;
  seed: DesignerEvalSeed;
}): DesignerEvalSeededState {
  const providerConnections = createSeededProviderConnections({
    runKey: input.runKey,
    seed: input.seed,
  });

  return {
    providerConnections,
    targetDraft: {
      profileId: `sbp_eval_${input.runKey}`,
      version: input.seed.targetDraft.version,
    },
  };
}

function createSeededProviderConnections(input: {
  runKey: string;
  seed: DesignerEvalSeed;
}): readonly DesignerEvalSeedProviderConnection[] {
  if (input.seed.providerConnections !== undefined) {
    return [...input.seed.providerConnections];
  }

  return [
    {
      id: `icn_eval_${input.runKey}_repo`,
      label: "GitHub",
      providerFamilyId: "github",
      targetKey: "github-cloud",
    },
  ];
}

function createSeededProviderResources(
  seed: DesignerEvalSeed,
): readonly DesignerEvalSeedProviderResource[] {
  if (seed.providerResources !== undefined) {
    return [...seed.providerResources];
  }

  const githubConnection = seed.providerConnections?.find(
    (connection) => connection.providerFamilyId === "github",
  );
  if (githubConnection === undefined) {
    return [];
  }

  return [
    {
      connectionId: githubConnection.id,
      kind: "repository",
      handle: "mistlehq/mistle",
    },
  ];
}
