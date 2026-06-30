import type { DesignerSessionResponse } from "@mistle/control-plane-api/designer";

import type {
  DesignerEvalCase,
  DesignerEvalProductState,
  DesignerEvalSeed,
  DesignerEvalSeededState,
} from "../types.ts";

export type DesignerEvalSessionState = {
  availableProviderResources: readonly DesignerEvalProviderResource[];
  designerSession: DesignerSessionResponse;
  productState: DesignerEvalProductState;
  seededState: DesignerEvalSeededState;
};

export type DesignerEvalProviderResource = {
  connectionId: string;
  kind: string;
  handle: string;
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
    availableProviderResources: input.evalCase.seed.githubRepositoryHandles.map((handle) => ({
      connectionId: seededState.githubConnectionId,
      kind: "repository",
      handle,
    })),
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
      availableProviderResources: input.evalCase.seed.githubRepositoryHandles.map((handle) => ({
        connectionId: seededState.githubConnectionId,
        kind: "repository",
        handle,
      })),
      targetDraft: {
        profileId: seededState.targetDraft.profileId,
        version: seededState.targetDraft.version,
        integrationBindings: [
          {
            id: `ibd_eval_${input.runKey}_agent`,
            connectionId: `icn_eval_${input.runKey}_agent`,
            kind: "agent",
            config: {},
          },
        ],
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
  return {
    githubConnectionId: `icn_eval_${input.runKey}_repo`,
    targetDraft: {
      profileId: `sbp_eval_${input.runKey}`,
      version: input.seed.targetDraft.version,
    },
  };
}
