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
        error: "Selected provider resource 'mistlehq/not-seeded' was not seeded for this eval.",
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
