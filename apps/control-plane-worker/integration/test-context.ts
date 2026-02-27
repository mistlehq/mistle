import {
  startPostgresWithPgBouncer,
  type PostgresWithPgBouncerService,
} from "@mistle/test-harness";
import { it as vitestIt } from "vitest";

import type { ControlPlaneWorkerConfig } from "../src/types.js";

export type ControlPlaneWorkerIntegrationFixture = {
  config: ControlPlaneWorkerConfig;
  databaseStack: PostgresWithPgBouncerService;
};

export const it = vitestIt.extend<{ fixture: ControlPlaneWorkerIntegrationFixture }>({
  fixture: [
    async ({}, use) => {
      const databaseStack = await startPostgresWithPgBouncer({
        databaseName: "mistle_control_plane_worker_integration",
      });

      const config: ControlPlaneWorkerConfig = {
        server: {
          host: "127.0.0.1",
          port: 3001,
        },
        workflow: {
          databaseUrl: databaseStack.directUrl,
          namespaceId: "integration",
          runMigrations: true,
          concurrency: 1,
        },
        email: {
          fromAddress: "no-reply@mistle.dev",
          fromName: "Mistle",
          smtpHost: "127.0.0.1",
          smtpPort: 1025,
          smtpSecure: false,
          smtpUsername: "mailpit",
          smtpPassword: "mailpit",
        },
        dataPlaneApi: {
          baseUrl: "http://127.0.0.1:5300",
        },
      };

      await use({
        config,
        databaseStack,
      });

      await databaseStack.stop();
    },
    {
      scope: "file",
    },
  ],
});
