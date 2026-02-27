import { startPostgresWithPgBouncer, type PostgresWithPgBouncerService } from "@mistle/test-core";
import { it as vitestIt } from "vitest";

export const it = vitestIt.extend<{ databaseStack: PostgresWithPgBouncerService }>({
  databaseStack: [
    async ({}, use) => {
      const databaseStack = await startPostgresWithPgBouncer({
        databaseName: "mistle_control_plane_test",
      });

      await use(databaseStack);
      await databaseStack.stop();
    },
    {
      scope: "file",
    },
  ],
});
