import {
  DesignerSessionSchema,
  SaveDesignerSelectedProviderResourcesResponseSchema,
} from "@mistle/control-plane-api/designer";
import { describe, expect, it } from "vitest";

import { getDesignerEvalCase } from "../cases/registry.ts";
import { createDesignerEvalApiClient } from "./api-client.ts";
import { startDesignerEvalControlPlane } from "./eval-control-plane.ts";
import { createDesignerEvalSessionState } from "./in-memory-state.ts";

describe("Designer eval control plane", () => {
  it("uses the eval case target draft id when seeding in-memory state", () => {
    const evalCase = getDesignerEvalCase("ai-software-factory-linear-github");
    const state = createDesignerEvalSessionState({
      evalCase,
      runKey: "run_key_does_not_match_case_id",
    });

    expect(state.seededState.targetDraft.profileId).toBe(evalCase.seed.targetDraft.profileId);
    expect(state.seededState.targetDraft.version).toBe(evalCase.seed.targetDraft.version);
    expect(state.designerSession.sandboxProfileId).toBe(evalCase.seed.targetDraft.profileId);
    expect(state.designerSession.sandboxProfileVersion).toBe(evalCase.seed.targetDraft.version);
    expect(state.productState.targetDraft.profileId).toBe(evalCase.seed.targetDraft.profileId);
    expect(state.productState.targetDraft.version).toBe(evalCase.seed.targetDraft.version);
  });

  it("persists canvas tabs in run-local memory through the Designer canvas-tabs route", async () => {
    const evalCase = getDesignerEvalCase("github-pr-review-basic");
    const state = createDesignerEvalSessionState({
      evalCase,
      runKey: "github_pr_review_basic",
    });
    const controlPlane = await startDesignerEvalControlPlane({ state });

    try {
      const apiClient = createDesignerEvalApiClient({
        baseUrl: controlPlane.baseUrl,
      });
      const response = DesignerSessionSchema.parse(
        await apiClient.putJson(`/v1/designer/sessions/${state.designerSession.id}/canvas-tabs`, {
          tabs: [
            {
              kind: "route",
              id: "provider-setup",
              title: "Provider setup",
              href: "/providers/github",
            },
          ],
        }),
      );

      expect(response.canvasTabs).toEqual([
        {
          kind: "route",
          id: "provider-setup",
          title: "Provider setup",
          href: "/providers/github",
        },
      ]);
      expect(state.designerSession.canvasTabs).toEqual(response.canvasTabs);
    } finally {
      await controlPlane.close();
    }
  });

  it("saves selected provider resources to the in-memory product state", async () => {
    const evalCase = getDesignerEvalCase("github-pr-review-basic");
    const state = createDesignerEvalSessionState({
      evalCase,
      runKey: "github_pr_review_basic",
    });
    const githubConnectionId = readSeededGithubConnectionId(state.seededState.providerConnections);
    const controlPlane = await startDesignerEvalControlPlane({ state });

    try {
      const apiClient = createDesignerEvalApiClient({
        baseUrl: controlPlane.baseUrl,
      });
      const response = SaveDesignerSelectedProviderResourcesResponseSchema.parse(
        await apiClient.postJson(
          `/v1/designer/sessions/${state.designerSession.id}/dashboard-actions/save-selected-provider-resources`,
          {
            targetDraft: state.seededState.targetDraft,
            connectionId: githubConnectionId,
            resourceKind: "repository",
            selectedHandles: ["mistlehq/mistle", "mistlehq/mistle"],
            bindingIntent: "git-repositories",
          },
        ),
      );

      expect(response).toEqual({
        kind: "sandbox-profile-draft-provider-resources-saved",
        profileId: state.seededState.targetDraft.profileId,
        version: state.seededState.targetDraft.version,
        connectionId: githubConnectionId,
        resourceKind: "repository",
        bindingIntent: "git-repositories",
        bindingId: `ibd_${githubConnectionId}_git`,
        selectedHandles: ["mistlehq/mistle"],
        createdBinding: true,
      });
      expect(state.productState.targetDraft.integrationBindings).toContainEqual({
        id: response.bindingId,
        connectionId: githubConnectionId,
        kind: "git",
        config: {
          repositories: ["mistlehq/mistle"],
        },
      });
    } finally {
      await controlPlane.close();
    }
  });

  it("preserves existing binding tools when selected provider resources are updated", async () => {
    const evalCase = getDesignerEvalCase("github-pr-review-basic");
    const state = createDesignerEvalSessionState({
      evalCase,
      runKey: "github_pr_review_basic",
    });
    const githubConnectionId = readSeededGithubConnectionId(state.seededState.providerConnections);
    state.productState.targetDraft.integrationBindings = [
      {
        id: "ibd_eval_existing_github",
        connectionId: githubConnectionId,
        kind: "git",
        config: {
          tools: ["github-cli"],
          repositories: ["mistlehq/previous"],
        },
      },
    ];
    const controlPlane = await startDesignerEvalControlPlane({ state });

    try {
      const apiClient = createDesignerEvalApiClient({
        baseUrl: controlPlane.baseUrl,
      });
      const response = SaveDesignerSelectedProviderResourcesResponseSchema.parse(
        await apiClient.postJson(
          `/v1/designer/sessions/${state.designerSession.id}/dashboard-actions/save-selected-provider-resources`,
          {
            targetDraft: state.seededState.targetDraft,
            connectionId: githubConnectionId,
            resourceKind: "repository",
            selectedHandles: ["mistlehq/mistle"],
            bindingIntent: "git-repositories",
          },
        ),
      );

      expect(response.createdBinding).toBe(false);
      expect(state.productState.targetDraft.integrationBindings).toEqual([
        {
          id: "ibd_eval_existing_github",
          connectionId: githubConnectionId,
          kind: "git",
          config: {
            tools: ["github-cli"],
            repositories: ["mistlehq/mistle"],
          },
        },
      ]);
    } finally {
      await controlPlane.close();
    }
  });

  it("rejects selected provider resource saves for a different target draft", async () => {
    const evalCase = getDesignerEvalCase("github-pr-review-basic");
    const state = createDesignerEvalSessionState({
      evalCase,
      runKey: "github_pr_review_basic",
    });
    const githubConnectionId = readSeededGithubConnectionId(state.seededState.providerConnections);
    const originalBindings = structuredClone(state.productState.targetDraft.integrationBindings);
    const controlPlane = await startDesignerEvalControlPlane({ state });

    try {
      const response = await fetch(
        new URL(
          `/v1/designer/sessions/${state.designerSession.id}/dashboard-actions/save-selected-provider-resources`,
          controlPlane.baseUrl,
        ),
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            targetDraft: {
              profileId: "sbp_eval_different",
              version: state.seededState.targetDraft.version,
            },
            connectionId: githubConnectionId,
            resourceKind: "repository",
            selectedHandles: ["mistlehq/mistle"],
            bindingIntent: "git-repositories",
          }),
        },
      );

      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({
        error: "Designer eval control-plane request failed.",
      });
      expect(state.productState.targetDraft.integrationBindings).toEqual(originalBindings);
    } finally {
      await controlPlane.close();
    }
  });

  it("rejects selected provider resource saves when an existing binding config is malformed", async () => {
    const evalCase = getDesignerEvalCase("github-pr-review-basic");
    const state = createDesignerEvalSessionState({
      evalCase,
      runKey: "github_pr_review_basic",
    });
    const githubConnectionId = readSeededGithubConnectionId(state.seededState.providerConnections);
    state.productState.targetDraft.integrationBindings = [
      {
        id: "ibd_eval_malformed_github",
        connectionId: githubConnectionId,
        kind: "git",
        config: "malformed",
      },
    ];
    const originalBindings = structuredClone(state.productState.targetDraft.integrationBindings);
    const controlPlane = await startDesignerEvalControlPlane({ state });

    try {
      const response = await fetch(
        new URL(
          `/v1/designer/sessions/${state.designerSession.id}/dashboard-actions/save-selected-provider-resources`,
          controlPlane.baseUrl,
        ),
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            targetDraft: state.seededState.targetDraft,
            connectionId: githubConnectionId,
            resourceKind: "repository",
            selectedHandles: ["mistlehq/mistle"],
            bindingIntent: "git-repositories",
          }),
        },
      );

      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({
        error: "Designer eval control-plane request failed.",
      });
      expect(state.productState.targetDraft.integrationBindings).toEqual(originalBindings);
    } finally {
      await controlPlane.close();
    }
  });

  it("rejects selected provider resources that were not seeded for the eval run", async () => {
    const evalCase = getDesignerEvalCase("github-pr-review-basic");
    const state = createDesignerEvalSessionState({
      evalCase,
      runKey: "github_pr_review_basic",
    });
    const githubConnectionId = readSeededGithubConnectionId(state.seededState.providerConnections);
    const controlPlane = await startDesignerEvalControlPlane({ state });

    try {
      const response = await fetch(
        new URL(
          `/v1/designer/sessions/${state.designerSession.id}/dashboard-actions/save-selected-provider-resources`,
          controlPlane.baseUrl,
        ),
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            targetDraft: state.seededState.targetDraft,
            connectionId: githubConnectionId,
            resourceKind: "repository",
            selectedHandles: ["mistlehq/not-seeded"],
            bindingIntent: "git-repositories",
          }),
        },
      );

      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({
        error: "Designer eval control-plane request failed.",
      });
      expect(state.productState.targetDraft.integrationBindings).toHaveLength(1);
    } finally {
      await controlPlane.close();
    }
  });
});

function readSeededGithubConnectionId(
  connections: readonly { id: string; providerFamilyId: string }[],
): string {
  const connection = connections.find((candidate) => candidate.providerFamilyId === "github");
  if (connection === undefined) {
    throw new Error("Expected seeded GitHub connection.");
  }

  return connection.id;
}
