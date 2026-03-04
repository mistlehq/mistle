/* eslint-disable jest/expect-expect, jest/no-disabled-tests, no-empty-pattern --
 * Vitest fixture extension file intentionally uses `vitestIt.extend(...)` and
 * object-destructuring fixture signatures.
 */

import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

import { createControlPlaneDatabase, type ControlPlaneDatabase } from "@mistle/db/control-plane";
import {
  createMailpitInbox,
  runCleanupTasks,
  startControlPlaneApi,
  startControlPlaneWorker,
} from "@mistle/test-harness";
import { Client, Pool } from "pg";
import { it as vitestIt } from "vitest";
import { z } from "zod";

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
const AUTH_ORIGIN = "http://localhost:5100";
const WORKER_DATABASE_NAME_PREFIX = "mistle_dashboard_it_worker_";
const OrganizationCreateResponseSchema = z.object({
  id: z.string().trim().min(1),
});

type SharedInfraConfig = {
  databaseUsername: string;
  databasePassword: string;
  databaseDirectHost: string;
  databaseDirectPort: number;
  templateDatabaseName: string;
  mailpitHttpBaseUrl: string;
  mailpitSmtpPort: number;
  containerHostGateway: string;
};

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
  const parsed = OrganizationCreateResponseSchema.safeParse(payload);
  if (!parsed.success) {
    return null;
  }

  return parsed.data.id;
}

function generateIntegrationAuthEmail(): string {
  return `integration-auth-${randomUUID()}@example.com`;
}

function createRequestFn(baseUrl: string): (path: string, init?: RequestInit) => Promise<Response> {
  return async (path, init) => {
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    return fetch(`${baseUrl}${normalizedPath}`, init);
  };
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`Missing required integration environment variable: ${name}`);
  }

  return value;
}

function parsePort(input: { value: string; variableName: string }): number {
  const parsedPort = Number.parseInt(input.value, 10);
  if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65_535) {
    throw new Error(`Environment variable ${input.variableName} must be a valid TCP port.`);
  }

  return parsedPort;
}

function readSharedInfraConfig(): SharedInfraConfig {
  return {
    databaseUsername: requireEnv("MISTLE_DASH_IT_DB_USER"),
    databasePassword: requireEnv("MISTLE_DASH_IT_DB_PASSWORD"),
    databaseDirectHost: requireEnv("MISTLE_DASH_IT_DB_DIRECT_HOST"),
    databaseDirectPort: parsePort({
      value: requireEnv("MISTLE_DASH_IT_DB_DIRECT_PORT"),
      variableName: "MISTLE_DASH_IT_DB_DIRECT_PORT",
    }),
    templateDatabaseName: requireEnv("MISTLE_DASH_IT_TEMPLATE_DB_NAME"),
    mailpitHttpBaseUrl: requireEnv("MISTLE_DASH_IT_MAILPIT_HTTP_BASE_URL"),
    mailpitSmtpPort: parsePort({
      value: requireEnv("MISTLE_DASH_IT_MAILPIT_SMTP_PORT"),
      variableName: "MISTLE_DASH_IT_MAILPIT_SMTP_PORT",
    }),
    containerHostGateway: requireEnv("MISTLE_DASH_IT_CONTAINER_HOST_GATEWAY"),
  };
}

function assertSafeIdentifier(identifier: string, label: string): string {
  if (!/^[a-z0-9_]+$/u.test(identifier)) {
    throw new Error(`${label} must contain only lowercase alphanumeric and underscore characters.`);
  }

  return identifier;
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier}"`;
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

function createWorkerScopedDatabaseName(poolId: string): string {
  const normalizedPoolId = poolId.replace(/[^a-zA-Z0-9_]/gu, "_").toLowerCase();
  if (normalizedPoolId.length === 0) {
    throw new Error("VITEST_POOL_ID must contain at least one alphanumeric character.");
  }

  return assertSafeIdentifier(
    `${WORKER_DATABASE_NAME_PREFIX}${normalizedPoolId}_${randomUUID().replaceAll("-", "")}`,
    "runtime database",
  );
}

async function runAdminQuery(input: { connectionString: string; sql: string }): Promise<void> {
  const adminClient = new Client({
    connectionString: input.connectionString,
  });

  await adminClient.connect();
  try {
    await adminClient.query(input.sql);
  } finally {
    await adminClient.end();
  }
}

async function resetRuntimeDatabaseFromTemplate(input: {
  adminConnectionString: string;
  runtimeDatabaseName: string;
  templateDatabaseName: string;
}): Promise<void> {
  await runAdminQuery({
    connectionString: input.adminConnectionString,
    sql: `DROP DATABASE IF EXISTS ${quoteIdentifier(input.runtimeDatabaseName)} WITH (FORCE)`,
  });
  await runAdminQuery({
    connectionString: input.adminConnectionString,
    sql: `CREATE DATABASE ${quoteIdentifier(input.runtimeDatabaseName)} TEMPLATE ${quoteIdentifier(input.templateDatabaseName)}`,
  });
}

export const it = vitestIt.extend<{ fixture: DashboardMembersInvitationsFixture }>({
  fixture: [
    async ({}, use) => {
      const cleanupTasks: Array<() => Promise<void>> = [];
      const sharedInfraConfig = readSharedInfraConfig();
      const runtimeDatabaseName = createWorkerScopedDatabaseName(process.env.VITEST_POOL_ID ?? "0");
      const adminConnectionString = createDatabaseUrl({
        username: sharedInfraConfig.databaseUsername,
        password: sharedInfraConfig.databasePassword,
        host: sharedInfraConfig.databaseDirectHost,
        port: sharedInfraConfig.databaseDirectPort,
        databaseName: "postgres",
      });

      try {
        await resetRuntimeDatabaseFromTemplate({
          adminConnectionString,
          runtimeDatabaseName,
          templateDatabaseName: assertSafeIdentifier(
            sharedInfraConfig.templateDatabaseName,
            "template database",
          ),
        });
        cleanupTasks.unshift(async () => {
          await runAdminQuery({
            connectionString: adminConnectionString,
            sql: `DROP DATABASE IF EXISTS ${quoteIdentifier(runtimeDatabaseName)} WITH (FORCE)`,
          });
        });

        const workflowNamespaceId = `integration_${randomUUID().replaceAll("-", "_")}`;
        const runtimeDatabaseUrl = createDatabaseUrl({
          username: sharedInfraConfig.databaseUsername,
          password: sharedInfraConfig.databasePassword,
          host: sharedInfraConfig.databaseDirectHost,
          port: sharedInfraConfig.databaseDirectPort,
          databaseName: runtimeDatabaseName,
        });
        const runtimeDatabaseUrlInContainer = createDatabaseUrl({
          username: sharedInfraConfig.databaseUsername,
          password: sharedInfraConfig.databasePassword,
          host: sharedInfraConfig.containerHostGateway,
          port: sharedInfraConfig.databaseDirectPort,
          databaseName: runtimeDatabaseName,
        });

        const apiService = await startControlPlaneApi({
          buildContextHostPath: PROJECT_ROOT_HOST_PATH,
          configPathInContainer: CONFIG_PATH_IN_CONTAINER,
          startupTimeoutMs: APP_STARTUP_TIMEOUT_MS,
          environment: {
            MISTLE_APPS_CONTROL_PLANE_API_DATABASE_URL: runtimeDatabaseUrlInContainer,
            MISTLE_APPS_CONTROL_PLANE_API_WORKFLOW_DATABASE_URL: runtimeDatabaseUrlInContainer,
            MISTLE_APPS_CONTROL_PLANE_API_WORKFLOW_NAMESPACE_ID: workflowNamespaceId,
            MISTLE_APPS_CONTROL_PLANE_API_AUTH_BASE_URL: AUTH_ORIGIN,
            MISTLE_APPS_CONTROL_PLANE_API_AUTH_INVITATION_ACCEPT_BASE_URL:
              "http://localhost:5173/invitations/accept",
            MISTLE_APPS_CONTROL_PLANE_API_AUTH_TRUSTED_ORIGINS:
              "http://localhost:5100,http://127.0.0.1:5100,http://localhost:5173,http://127.0.0.1:5173",
          },
        });
        cleanupTasks.unshift(async () => {
          await apiService.stop();
        });

        const workerService = await startControlPlaneWorker({
          buildContextHostPath: PROJECT_ROOT_HOST_PATH,
          configPathInContainer: CONFIG_PATH_IN_CONTAINER,
          startupTimeoutMs: APP_STARTUP_TIMEOUT_MS,
          environment: {
            MISTLE_APPS_CONTROL_PLANE_WORKER_WORKFLOW_DATABASE_URL: runtimeDatabaseUrlInContainer,
            MISTLE_APPS_CONTROL_PLANE_WORKER_WORKFLOW_NAMESPACE_ID: workflowNamespaceId,
            MISTLE_APPS_CONTROL_PLANE_WORKER_WORKFLOW_RUN_MIGRATIONS: "false",
            MISTLE_APPS_CONTROL_PLANE_WORKER_SMTP_HOST: sharedInfraConfig.containerHostGateway,
            MISTLE_APPS_CONTROL_PLANE_WORKER_SMTP_PORT: String(sharedInfraConfig.mailpitSmtpPort),
            MISTLE_APPS_CONTROL_PLANE_WORKER_SMTP_SECURE: "false",
          },
        });
        cleanupTasks.unshift(async () => {
          await workerService.stop();
        });

        const databasePool = new Pool({
          connectionString: runtimeDatabaseUrl,
        });
        cleanupTasks.unshift(async () => {
          await databasePool.end();
        });

        const db = createControlPlaneDatabase(databasePool);
        const request = createRequestFn(apiService.hostBaseUrl);
        const mailpitInbox = createMailpitInbox({
          httpBaseUrl: sharedInfraConfig.mailpitHttpBaseUrl,
        });

        await use({
          db,
          request,
          authSession: async (input) => {
            const email = input?.email ?? generateIntegrationAuthEmail();

            const sendResponse = await request("/v1/auth/email-otp/send-verification-otp", {
              method: "POST",
              headers: {
                "content-type": "application/json",
                origin: AUTH_ORIGIN,
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

            const listItem = await mailpitInbox.waitForMessage({
              timeoutMs: 15_000,
              description: `OTP email for ${email}`,
              matcher: ({ message }) =>
                message.Subject === "Your sign-in code" &&
                message.To.some((address) => address.Address === email),
            });
            const message = await mailpitInbox.getMessageSummary(listItem.ID);
            const otp = extractOTPCode(message.Text);
            if (otp === undefined) {
              throw new Error("OTP was not found in Mailpit message text.");
            }

            const signInResponse = await request("/v1/auth/sign-in/email-otp", {
              method: "POST",
              headers: {
                "content-type": "application/json",
                origin: AUTH_ORIGIN,
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
                  origin: AUTH_ORIGIN,
                },
                body: JSON.stringify({
                  name: "Integration Organization",
                  slug: `integration-${randomUUID()}`,
                }),
              });
              if (createOrganizationResponse.status !== 200) {
                const errorBody = await createOrganizationResponse.text().catch(() => "");
                throw new Error(
                  `Expected organization create response status 200, got ${String(createOrganizationResponse.status)}. Response body: ${errorBody}`,
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
