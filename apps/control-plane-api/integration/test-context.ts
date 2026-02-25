import { CONTROL_PLANE_SCHEMA_NAME, type ControlPlaneDatabase } from "@mistle/db/control-plane";
import {
  CONTROL_PLANE_MIGRATIONS_FOLDER_PATH,
  MigrationTracking,
  runControlPlaneMigrations,
} from "@mistle/db/migrator";
import {
  startMailpit,
  startPostgresWithPgBouncer,
  type MailpitService,
  type PostgresWithPgBouncerService,
} from "@mistle/test-harness";
import { it as vitestIt } from "vitest";

import type { ControlPlaneApiConfig } from "../src/types.js";

import { createControlPlaneApiRuntime } from "../src/runtime.js";

export type ControlPlaneApiIntegrationFixture = {
  config: ControlPlaneApiConfig;
  db: ControlPlaneDatabase;
  mailpitService: MailpitService;
  databaseStack: PostgresWithPgBouncerService;
  request: (path: string, init?: RequestInit) => Promise<Response>;
};

export const it = vitestIt.extend<{ fixture: ControlPlaneApiIntegrationFixture }>({
  fixture: [
    async ({}, use) => {
      const databaseStack = await startPostgresWithPgBouncer({
        databaseName: "mistle_control_plane_api_integration",
      });
      const mailpitService = await startMailpit();

      await runControlPlaneMigrations({
        connectionString: databaseStack.directUrl,
        schemaName: CONTROL_PLANE_SCHEMA_NAME,
        migrationsFolder: CONTROL_PLANE_MIGRATIONS_FOLDER_PATH,
        migrationsSchema: MigrationTracking.CONTROL_PLANE.SCHEMA_NAME,
        migrationsTable: MigrationTracking.CONTROL_PLANE.TABLE_NAME,
      });

      const config: ControlPlaneApiConfig = {
        server: {
          host: "127.0.0.1",
          port: 3000,
        },
        database: {
          url: databaseStack.pooledUrl,
        },
        auth: {
          baseUrl: "http://localhost:3000",
          secret: "integration-auth-secret",
          trustedOrigins: ["http://localhost:3000"],
          otpLength: 6,
          otpExpiresInSeconds: 300,
          otpAllowedAttempts: 3,
        },
        email: {
          fromAddress: "no-reply@mistle.dev",
          fromName: "Mistle",
          smtpHost: mailpitService.smtpHost,
          smtpPort: mailpitService.smtpPort,
          smtpSecure: false,
          smtpUsername: "mailpit",
          smtpPassword: "mailpit",
        },
      };

      const runtime = createControlPlaneApiRuntime(config);

      await use({
        config,
        db: runtime.db,
        mailpitService,
        databaseStack,
        request: runtime.request,
      });

      await runtime.stop();
      await mailpitService.stop();
      await databaseStack.stop();
    },
    {
      scope: "file",
    },
  ],
});
