/* eslint-disable jest/expect-expect, jest/no-disabled-tests, no-empty-pattern --
 * Vitest fixture extension file intentionally uses `vitestIt.extend(...)` and
 * object-destructuring fixture signatures.
 */

import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

import { createControlPlaneDatabase, type ControlPlaneDatabase } from "@mistle/db/control-plane";
import {
  runCleanupTasks,
  startControlPlaneApi,
  startControlPlaneWorker,
  startMailpit,
  startPostgresWithPgBouncer,
} from "@mistle/test-harness";
import { Pool } from "pg";
import { Network } from "testcontainers";
import { it as vitestIt } from "vitest";

export type AuthenticatedSession = {
  cookie: string;
  organizationId: string;
  userId: string;
};

export type DashboardMembersInvitationsFixture = {
  db: ControlPlaneDatabase;
  request: (path: string, init?: RequestInit) => Promise<Response>;
  authSession: (input?: { email?: string }) => Promise<AuthenticatedSession>;
};

const AUTH_OTP_LENGTH = 6;
const PROJECT_ROOT_HOST_PATH = fileURLToPath(new URL("../../..", import.meta.url));
const CONFIG_PATH_IN_CONTAINER = "/workspace/config/config.development.toml";
const APP_STARTUP_TIMEOUT_MS = 120_000;
const PGBOUNCER_NETWORK_ALIAS = "pgbouncer";
const PGBOUNCER_PORT_IN_NETWORK = 5432;
const MAILPIT_NETWORK_ALIAS = "mailpit";
const MAILPIT_SMTP_PORT_IN_NETWORK = 1025;

function extractOTPCode(text: string): string | undefined {
  const pattern = new RegExp(`\\b(\\d{${String(AUTH_OTP_LENGTH)}})\\b`);
  const match = text.match(pattern);

  return match?.[1];
}

function extractRequestCookie(setCookieHeader: string): string {
  const [cookiePair] = setCookieHeader.split(";");
  if (cookiePair === undefined || cookiePair.length === 0) {
    throw new Error("Expected sign-in response to include a usable cookie value.");
  }

  return cookiePair;
}

function readOrganizationIdFromPayload(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }

  const id = Reflect.get(payload, "id");
  return typeof id === "string" && id.length > 0 ? id : null;
}

function generateIntegrationAuthEmail(): string {
  return `integration-auth-${randomUUID()}@example.com`;
}

function createDatabaseUrl(input: {
  username: string;
  password: string;
  host: string;
  port: number;
  databaseName: string;
}): string {
  return `postgresql://${encodeURIComponent(input.username)}:${encodeURIComponent(input.password)}@${input.host}:${String(input.port)}/${input.databaseName}`;
}

function createRequestFn(baseUrl: string): (path: string, init?: RequestInit) => Promise<Response> {
  return async (path, init) => {
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    return fetch(`${baseUrl}${normalizedPath}`, init);
  };
}

export const it = vitestIt.extend<{ fixture: DashboardMembersInvitationsFixture }>({
  fixture: [
    async ({}, use) => {
      const cleanupTasks: Array<() => Promise<void>> = [];
      try {
        const workflowNamespaceId = `integration_${randomUUID().replaceAll("-", "_")}`;
        const network = await new Network().start();
        cleanupTasks.unshift(async () => {
          await network.stop();
        });

        const databaseStack = await startPostgresWithPgBouncer({
          databaseName: `mistle_dashboard_integration_${randomUUID().replaceAll("-", "_")}`,
          network,
          pgbouncerNetworkAlias: PGBOUNCER_NETWORK_ALIAS,
        });
        cleanupTasks.unshift(async () => {
          await databaseStack.stop();
        });

        const mailpitService = await startMailpit({
          network,
          networkAlias: MAILPIT_NETWORK_ALIAS,
        });
        cleanupTasks.unshift(async () => {
          await mailpitService.stop();
        });

        const pooledDatabaseUrlInNetwork = createDatabaseUrl({
          username: databaseStack.postgres.username,
          password: databaseStack.postgres.password,
          host: PGBOUNCER_NETWORK_ALIAS,
          port: PGBOUNCER_PORT_IN_NETWORK,
          databaseName: databaseStack.postgres.databaseName,
        });

        const apiService = await startControlPlaneApi({
          buildContextHostPath: PROJECT_ROOT_HOST_PATH,
          configPathInContainer: CONFIG_PATH_IN_CONTAINER,
          startupTimeoutMs: APP_STARTUP_TIMEOUT_MS,
          network,
          environment: {
            MISTLE_APPS_CONTROL_PLANE_API_DATABASE_URL: pooledDatabaseUrlInNetwork,
            MISTLE_APPS_CONTROL_PLANE_API_WORKFLOW_DATABASE_URL: pooledDatabaseUrlInNetwork,
            MISTLE_APPS_CONTROL_PLANE_API_WORKFLOW_NAMESPACE_ID: workflowNamespaceId,
          },
        });
        cleanupTasks.unshift(async () => {
          await apiService.stop();
        });

        const workerService = await startControlPlaneWorker({
          buildContextHostPath: PROJECT_ROOT_HOST_PATH,
          configPathInContainer: CONFIG_PATH_IN_CONTAINER,
          startupTimeoutMs: APP_STARTUP_TIMEOUT_MS,
          network,
          environment: {
            MISTLE_APPS_CONTROL_PLANE_WORKER_WORKFLOW_DATABASE_URL: pooledDatabaseUrlInNetwork,
            MISTLE_APPS_CONTROL_PLANE_WORKER_WORKFLOW_NAMESPACE_ID: workflowNamespaceId,
            MISTLE_APPS_CONTROL_PLANE_WORKER_SMTP_HOST: MAILPIT_NETWORK_ALIAS,
            MISTLE_APPS_CONTROL_PLANE_WORKER_SMTP_PORT: String(MAILPIT_SMTP_PORT_IN_NETWORK),
            MISTLE_APPS_CONTROL_PLANE_WORKER_SMTP_SECURE: "false",
            MISTLE_APPS_CONTROL_PLANE_WORKER_SMTP_USERNAME: "",
            MISTLE_APPS_CONTROL_PLANE_WORKER_SMTP_PASSWORD: "",
          },
        });
        cleanupTasks.unshift(async () => {
          await workerService.stop();
        });

        const databasePool = new Pool({
          connectionString: databaseStack.pooledUrl,
        });
        cleanupTasks.unshift(async () => {
          await databasePool.end();
        });

        const db = createControlPlaneDatabase(databasePool);
        const request = createRequestFn(apiService.hostBaseUrl);

        await use({
          db,
          request,
          authSession: async (input) => {
            const email = input?.email ?? generateIntegrationAuthEmail();

            const sendResponse = await request("/v1/auth/email-otp/send-verification-otp", {
              method: "POST",
              headers: {
                "content-type": "application/json",
              },
              body: JSON.stringify({
                email,
                type: "sign-in",
              }),
            });
            if (sendResponse.status !== 200) {
              throw new Error(
                `Expected OTP send response status 200, got ${String(sendResponse.status)}.`,
              );
            }

            const listItem = await mailpitService.waitForMessage({
              timeoutMs: 15_000,
              description: `OTP email for ${email}`,
              matcher: ({ message }) =>
                message.Subject === "Your sign-in code" &&
                message.To.some((address) => address.Address === email),
            });
            const message = await mailpitService.getMessageSummary(listItem.ID);
            const otp = extractOTPCode(message.Text);
            if (otp === undefined) {
              throw new Error("OTP was not found in Mailpit message text.");
            }

            const signInResponse = await request("/v1/auth/sign-in/email-otp", {
              method: "POST",
              headers: {
                "content-type": "application/json",
              },
              body: JSON.stringify({
                email,
                otp,
              }),
            });
            if (signInResponse.status !== 200) {
              throw new Error(
                `Expected OTP sign-in response status 200, got ${String(signInResponse.status)}.`,
              );
            }

            const setCookie = signInResponse.headers.get("set-cookie");
            if (typeof setCookie !== "string" || setCookie.length === 0) {
              throw new Error("Expected sign-in response to include set-cookie.");
            }

            const user = await db.query.users.findFirst({
              columns: {
                id: true,
              },
              where: (users, { eq }) => eq(users.email, email),
            });
            if (user === undefined) {
              throw new Error("Expected user to be created after OTP sign-in.");
            }

            const session = await db.query.sessions.findFirst({
              columns: {
                activeOrganizationId: true,
              },
              where: (sessions, { eq }) => eq(sessions.userId, user.id),
              orderBy: (sessions, { desc }) => [desc(sessions.createdAt)],
            });
            if (session === undefined) {
              throw new Error("Expected session to exist after OTP sign-in.");
            }

            const requestCookie = extractRequestCookie(setCookie);
            let activeOrganizationId =
              typeof session.activeOrganizationId === "string" &&
              session.activeOrganizationId.length > 0
                ? session.activeOrganizationId
                : null;

            if (activeOrganizationId === null) {
              const createOrganizationResponse = await request("/v1/auth/organization/create", {
                method: "POST",
                headers: {
                  "content-type": "application/json",
                  cookie: requestCookie,
                },
                body: JSON.stringify({
                  name: "Integration Organization",
                  slug: `integration-${randomUUID()}`,
                }),
              });
              if (createOrganizationResponse.status !== 200) {
                throw new Error(
                  `Expected organization create response status 200, got ${String(createOrganizationResponse.status)}.`,
                );
              }

              const createOrganizationPayload: unknown = await createOrganizationResponse
                .json()
                .catch(() => null);
              activeOrganizationId = readOrganizationIdFromPayload(createOrganizationPayload);
              if (activeOrganizationId === null) {
                throw new Error(
                  "Expected organization create response to include organization id.",
                );
              }
            }

            return {
              cookie: requestCookie,
              organizationId: activeOrganizationId,
              userId: user.id,
            };
          },
        });
      } finally {
        await runCleanupTasks({
          tasks: cleanupTasks,
          context: "dashboard members invitations fixture cleanup",
        });
      }
    },
    {
      scope: "file",
    },
  ],
});
