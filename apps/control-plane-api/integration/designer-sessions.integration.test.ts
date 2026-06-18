/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import { ApiKeyActorKinds } from "@mistle/db/control-plane";
import { createIntegrationTest } from "@mistle/test-harness/integration";
import { describe, expect } from "vitest";

import { generateApiKeySecret } from "../src/api-keys/services/api-key-secret.js";
import { OrganizationPermissions } from "../src/auth/services/organization-policy.js";
import {
  DesignerSessionSchema,
  ListDesignerSessionsResponseSchema,
} from "../src/designer/index.js";
import { waitForQueuedStartWorkflowInput } from "./helpers/data-plane-workflows.js";

const it = createIntegrationTest({
  services: ["control-plane-api", "data-plane-api"],
});

describe.concurrent("designer sessions integration", () => {
  it("creates, lists, reads, and updates a Designer session in the authenticated organization", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-designer-session@example.com",
    });

    const createResponse = await env.controlPlaneApi.http.fetch("/v1/designer/sessions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: session.cookie,
      },
      body: JSON.stringify({
        idempotencyKey: "designer-session-integration-create",
        prompt: "Build a triage agent for GitHub issues and Linear bugs.",
      }),
    });
    expect(createResponse.status).toBe(201);
    const created = DesignerSessionSchema.parse(await createResponse.json());
    expect(created).toMatchObject({
      organizationId: session.organizationId,
      status: "pending",
      connectable: false,
      initialPrompt: "Build a triage agent for GitHub issues and Linear bugs.",
      canvasTabs: [],
    });
    expect(created.id).toMatch(/^dsn_[a-zA-Z0-9_-]+$/);
    expect(created.sandboxInstanceId).toMatch(/^sbi_[a-zA-Z0-9_-]+$/);
    const queuedWorkflowInput = await waitForQueuedStartWorkflowInput({
      env,
      sandboxInstanceId: created.sandboxInstanceId,
    });
    const platformOpenAiRoute = queuedWorkflowInput.runtimePlan.egressRoutes.find(
      (route) => route.credentialResolver.kind === "platform_openai_api_key",
    );
    expect(platformOpenAiRoute?.upstream.baseUrl).toBe("https://api.openai.com/v1");
    const codexConfig = queuedWorkflowInput.runtimePlan.runtimeClients
      .flatMap((client) => client.setup.files)
      .find((file) => file.fileId === "codex_config");
    const codexRuntimeProcess = queuedWorkflowInput.runtimePlan.runtimeClients
      .flatMap((client) => client.processes)
      .find((process) => process.processKey === "codex-app-server");
    expect(queuedWorkflowInput.runtimePlan.artifacts).toEqual([]);
    expect(codexRuntimeProcess?.command.args[0]).toBe("codex");
    expect(codexConfig?.content).toContain('base_url = "https://api.openai.com/v1"');
    expect(codexConfig?.content).toContain("[mcp_servers.mistle_docs]");
    expect(codexConfig?.content).toContain('url = "https://docs.mistle.dev/mcp"');
    const codexAgents = queuedWorkflowInput.runtimePlan.runtimeClients
      .flatMap((client) => client.setup.files)
      .find((file) => file.fileId === "codex_global_agents");
    expect(codexAgents?.content).toContain("Mistle-managed sandbox context:");
    expect(codexAgents?.content).toContain("<!-- MISTLE-MANAGED:START mistle-designer-context -->");
    expect(codexAgents?.content).toContain("# Mistle Designer");
    expect(codexAgents?.content).toContain(
      "<!-- MISTLE-MANAGED:START mistle-designer-initial-request -->",
    );
    expect(codexAgents?.content).toContain(
      "Build a triage agent for GitHub issues and Linear bugs.",
    );
    expect(codexAgents?.content).toContain(
      "Do not publish sandbox profile versions, start sandbox sessions, create provider-side resources, or mutate external provider configuration unless there is an explicit approved Designer action for that operation.",
    );
    expect(codexAgents?.content).toContain("Search Mistle docs with the `mistle_docs` MCP server");

    const listResponse = await env.controlPlaneApi.http.fetch("/v1/designer/sessions", {
      headers: {
        cookie: session.cookie,
      },
    });
    expect(listResponse.status).toBe(200);
    const list = ListDesignerSessionsResponseSchema.parse(await listResponse.json());
    expect(list.items.map((item) => item.id)).toContain(created.id);
    expect(list.items.find((item) => item.id === created.id)).toMatchObject({
      sandboxInstanceId: created.sandboxInstanceId,
      status: "pending",
    });

    const getResponse = await env.controlPlaneApi.http.fetch(
      `/v1/designer/sessions/${encodeURIComponent(created.id)}`,
      {
        headers: {
          cookie: session.cookie,
        },
      },
    );
    expect(getResponse.status).toBe(200);
    const read = DesignerSessionSchema.parse(await getResponse.json());
    expect(read).toMatchObject({
      id: created.id,
      organizationId: session.organizationId,
      sandboxInstanceId: created.sandboxInstanceId,
      canvasTabs: [],
    });

    const getBySandboxInstanceResponse = await env.controlPlaneApi.http.fetch(
      `/v1/designer/sandbox-instances/${encodeURIComponent(created.sandboxInstanceId)}`,
      {
        headers: {
          cookie: session.cookie,
        },
      },
    );
    expect(getBySandboxInstanceResponse.status).toBe(200);
    expect(DesignerSessionSchema.parse(await getBySandboxInstanceResponse.json())).toMatchObject({
      id: created.id,
      organizationId: session.organizationId,
      sandboxInstanceId: created.sandboxInstanceId,
      canvasTabs: [],
    });

    const updateResponse = await env.controlPlaneApi.http.fetch(
      `/v1/designer/sessions/${encodeURIComponent(created.id)}/canvas-tabs`,
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          cookie: session.cookie,
        },
        body: JSON.stringify({
          tabs: [
            {
              id: "integrations",
              title: "Integrations",
              href: "/integrations",
            },
            {
              id: "sandbox-profile",
              title: "Sandbox Profile",
              href: "/sandbox-profiles/sbp_designer/draft",
            },
          ],
        }),
      },
    );
    expect(updateResponse.status).toBe(200);
    const updated = DesignerSessionSchema.parse(await updateResponse.json());
    expect(updated.canvasTabs).toEqual([
      {
        id: "integrations",
        title: "Integrations",
        href: "/integrations",
      },
      {
        id: "sandbox-profile",
        title: "Sandbox Profile",
        href: "/sandbox-profiles/sbp_designer/draft",
      },
    ]);

    const updateBySandboxInstanceResponse = await env.controlPlaneApi.http.fetch(
      `/v1/designer/sandbox-instances/${encodeURIComponent(created.sandboxInstanceId)}/canvas-tabs`,
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          cookie: session.cookie,
        },
        body: JSON.stringify({
          tabs: [
            {
              id: "session",
              title: "Session",
              href: `/sessions/${created.sandboxInstanceId}`,
            },
          ],
        }),
      },
    );
    expect(updateBySandboxInstanceResponse.status).toBe(200);
    expect(
      DesignerSessionSchema.parse(await updateBySandboxInstanceResponse.json()).canvasTabs,
    ).toEqual([
      {
        id: "session",
        title: "Session",
        href: `/sessions/${created.sandboxInstanceId}`,
      },
    ]);
  });

  it("requires an idempotency key when creating a Designer session", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-designer-session-idempotency-key-required@example.com",
    });

    const createResponse = await env.controlPlaneApi.http.fetch("/v1/designer/sessions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: session.cookie,
      },
      body: JSON.stringify({}),
    });

    expect(createResponse.status).toBe(400);
  });

  it("rejects Designer canvas tabs with non-dashboard-internal hrefs", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-designer-session-canvas-href-validation@example.com",
    });

    const createResponse = await env.controlPlaneApi.http.fetch("/v1/designer/sessions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: session.cookie,
      },
      body: JSON.stringify({
        idempotencyKey: "designer-session-canvas-href-validation",
        prompt: "Build a Designer canvas validation check.",
      }),
    });
    expect(createResponse.status).toBe(201);
    const created = DesignerSessionSchema.parse(await createResponse.json());

    for (const href of ["http://[", "https://example.com/integrations", "//example.com"]) {
      const updateResponse = await env.controlPlaneApi.http.fetch(
        `/v1/designer/sessions/${encodeURIComponent(created.id)}/canvas-tabs`,
        {
          method: "PUT",
          headers: {
            "content-type": "application/json",
            cookie: session.cookie,
          },
          body: JSON.stringify({
            tabs: [
              {
                id: "invalid",
                title: "Invalid",
                href,
              },
            ],
          }),
        },
      );
      expect(updateResponse.status).toBe(400);
    }
  });

  it("does not expose Designer sessions across organizations", async ({ env }) => {
    const firstOrgSession = await env.auth.createSession({
      email: "integration-new-designer-session-org-a@example.com",
    });
    const secondOrgSession = await env.auth.createSession({
      email: "integration-new-designer-session-org-b@example.com",
    });

    const createResponse = await env.controlPlaneApi.http.fetch("/v1/designer/sessions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: firstOrgSession.cookie,
      },
      body: JSON.stringify({
        idempotencyKey: "designer-session-integration-org-boundary",
        prompt: "Build an organization-scoped Designer agent.",
      }),
    });
    expect(createResponse.status).toBe(201);
    const created = DesignerSessionSchema.parse(await createResponse.json());

    const getFromOtherOrgResponse = await env.controlPlaneApi.http.fetch(
      `/v1/designer/sessions/${encodeURIComponent(created.id)}`,
      {
        headers: {
          cookie: secondOrgSession.cookie,
        },
      },
    );
    expect(getFromOtherOrgResponse.status).toBe(404);

    const getBySandboxInstanceFromOtherOrgResponse = await env.controlPlaneApi.http.fetch(
      `/v1/designer/sandbox-instances/${encodeURIComponent(created.sandboxInstanceId)}`,
      {
        headers: {
          cookie: secondOrgSession.cookie,
        },
      },
    );
    expect(getBySandboxInstanceFromOtherOrgResponse.status).toBe(404);

    const updateFromOtherOrgResponse = await env.controlPlaneApi.http.fetch(
      `/v1/designer/sessions/${encodeURIComponent(created.id)}/canvas-tabs`,
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          cookie: secondOrgSession.cookie,
        },
        body: JSON.stringify({
          tabs: [
            {
              id: "integrations",
              title: "Integrations",
              href: "/integrations",
            },
          ],
        }),
      },
    );
    expect(updateFromOtherOrgResponse.status).toBe(404);

    const updateBySandboxInstanceFromOtherOrgResponse = await env.controlPlaneApi.http.fetch(
      `/v1/designer/sandbox-instances/${encodeURIComponent(created.sandboxInstanceId)}/canvas-tabs`,
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          cookie: secondOrgSession.cookie,
        },
        body: JSON.stringify({
          tabs: [
            {
              id: "integrations",
              title: "Integrations",
              href: "/integrations",
            },
          ],
        }),
      },
    );
    expect(updateBySandboxInstanceFromOtherOrgResponse.status).toBe(404);
  });

  it("rejects API key actors on Designer routes", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-designer-session-api-key@example.com",
    });

    const createResponse = await env.controlPlaneApi.http.fetch("/v1/designer/sessions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: session.cookie,
      },
      body: JSON.stringify({
        idempotencyKey: "designer-session-api-key-rejection-create",
        prompt: "Build an API key rejection test Designer agent.",
      }),
    });
    expect(createResponse.status).toBe(201);
    const created = DesignerSessionSchema.parse(await createResponse.json());

    const apiKeySecret = generateApiKeySecret();
    await env.controlPlaneDb.insert(env.controlPlaneTables.apiKeys).values({
      id: "apk_designer_session_rejection",
      organizationId: session.organizationId,
      name: "Designer rejection",
      secretPrefix: apiKeySecret.secretPrefix,
      secretHash: apiKeySecret.secretHash,
      secretHashAlgorithm: apiKeySecret.secretHashAlgorithm,
      createdByActorKind: ApiKeyActorKinds.USER,
      createdByActorId: session.userId,
    });
    await env.controlPlaneDb.insert(env.controlPlaneTables.apiKeyPermissions).values([
      {
        apiKeyId: "apk_designer_session_rejection",
        permission: OrganizationPermissions.DESIGNER_SESSION_CREATE,
      },
      {
        apiKeyId: "apk_designer_session_rejection",
        permission: OrganizationPermissions.DESIGNER_SESSION_READ,
      },
      {
        apiKeyId: "apk_designer_session_rejection",
        permission: OrganizationPermissions.DESIGNER_SESSION_UPDATE,
      },
    ]);

    const apiKeyHeaders = {
      authorization: `Bearer ${apiKeySecret.token}`,
      "content-type": "application/json",
    };

    const rejectedCreateResponse = await env.controlPlaneApi.http.fetch("/v1/designer/sessions", {
      method: "POST",
      headers: apiKeyHeaders,
      body: JSON.stringify({
        idempotencyKey: "designer-session-api-key-rejection-forbidden",
        prompt: "Build a forbidden API key Designer agent.",
      }),
    });
    expect(rejectedCreateResponse.status).toBe(403);

    const rejectedListResponse = await env.controlPlaneApi.http.fetch("/v1/designer/sessions", {
      headers: {
        authorization: `Bearer ${apiKeySecret.token}`,
      },
    });
    expect(rejectedListResponse.status).toBe(403);

    const rejectedGetResponse = await env.controlPlaneApi.http.fetch(
      `/v1/designer/sessions/${encodeURIComponent(created.id)}`,
      {
        headers: {
          authorization: `Bearer ${apiKeySecret.token}`,
        },
      },
    );
    expect(rejectedGetResponse.status).toBe(403);

    const rejectedGetBySandboxInstanceResponse = await env.controlPlaneApi.http.fetch(
      `/v1/designer/sandbox-instances/${encodeURIComponent(created.sandboxInstanceId)}`,
      {
        headers: {
          authorization: `Bearer ${apiKeySecret.token}`,
        },
      },
    );
    expect(rejectedGetBySandboxInstanceResponse.status).toBe(403);

    const rejectedUpdateResponse = await env.controlPlaneApi.http.fetch(
      `/v1/designer/sessions/${encodeURIComponent(created.id)}/canvas-tabs`,
      {
        method: "PUT",
        headers: apiKeyHeaders,
        body: JSON.stringify({
          tabs: [
            {
              id: "integrations",
              title: "Integrations",
              href: "/integrations",
            },
          ],
        }),
      },
    );
    expect(rejectedUpdateResponse.status).toBe(403);

    const rejectedUpdateBySandboxInstanceResponse = await env.controlPlaneApi.http.fetch(
      `/v1/designer/sandbox-instances/${encodeURIComponent(created.sandboxInstanceId)}/canvas-tabs`,
      {
        method: "PUT",
        headers: apiKeyHeaders,
        body: JSON.stringify({
          tabs: [
            {
              id: "integrations",
              title: "Integrations",
              href: "/integrations",
            },
          ],
        }),
      },
    );
    expect(rejectedUpdateBySandboxInstanceResponse.status).toBe(403);
  });
});
