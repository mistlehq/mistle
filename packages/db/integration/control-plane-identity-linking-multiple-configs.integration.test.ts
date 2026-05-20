import { Pool } from "pg";
import { describe } from "vitest";

import { CONTROL_PLANE_SCHEMA_NAME } from "../src/control-plane/schema/namespace.js";
import {
  CONTROL_PLANE_MIGRATIONS_FOLDER_PATH,
  MigrationTracking,
  runControlPlaneMigrations,
} from "../src/migrator/index.js";
import { it } from "./test-context.js";

describe("control-plane identity-linking multiple configs integration", () => {
  it("enforces identity-linking uniqueness at provider config scope", async ({ databaseStack }) => {
    await runControlPlaneMigrations({
      connectionString: databaseStack.directUrl,
      schemaName: CONTROL_PLANE_SCHEMA_NAME,
      migrationsFolder: CONTROL_PLANE_MIGRATIONS_FOLDER_PATH,
      migrationsSchema: MigrationTracking.CONTROL_PLANE.SCHEMA_NAME,
      migrationsTable: MigrationTracking.CONTROL_PLANE.TABLE_NAME,
    });

    const pool = new Pool({
      connectionString: databaseStack.directUrl,
    });

    try {
      await insertIdentityLinkingFixtures(pool);

      await insertProviderConfig(pool, {
        id: "ilp_multiple_configs_slack_workspace_a",
        connectionId: "icn_multiple_configs_slack_workspace_a",
      });
      await insertProviderConfig(pool, {
        id: "ilp_multiple_configs_slack_workspace_b",
        connectionId: "icn_multiple_configs_slack_workspace_b",
      });

      const duplicateConnectionError = await capturePgErrorCode(
        insertProviderConfig(pool, {
          id: "ilp_multiple_configs_duplicate_connection",
          connectionId: "icn_multiple_configs_slack_workspace_a",
        }),
      );
      assertPgUniqueViolation(
        duplicateConnectionError,
        "duplicate identity-link provider config connection insert",
      );

      await insertPrincipal(pool, {
        id: "uep_multiple_configs_workspace_a_user_one",
        userId: "usr_multiple_configs_one",
        providerSubjectId: "T_workspace_a:U_shared",
        configId: "ilp_multiple_configs_slack_workspace_a",
        connectionId: "icn_multiple_configs_slack_workspace_a",
      });
      await insertPrincipal(pool, {
        id: "uep_multiple_configs_workspace_b_user_one",
        userId: "usr_multiple_configs_one",
        providerSubjectId: "T_workspace_b:U_shared",
        configId: "ilp_multiple_configs_slack_workspace_b",
        connectionId: "icn_multiple_configs_slack_workspace_b",
      });
      await insertPrincipal(pool, {
        id: "uep_multiple_configs_workspace_a_user_two",
        userId: "usr_multiple_configs_two",
        providerSubjectId: "T_workspace_a:U_two",
        configId: "ilp_multiple_configs_slack_workspace_a",
        connectionId: "icn_multiple_configs_slack_workspace_a",
      });

      const duplicateActiveUserInConfigError = await capturePgErrorCode(
        insertPrincipal(pool, {
          id: "uep_multiple_configs_workspace_a_duplicate_user",
          userId: "usr_multiple_configs_one",
          providerSubjectId: "T_workspace_a:U_duplicate_user",
          configId: "ilp_multiple_configs_slack_workspace_a",
          connectionId: "icn_multiple_configs_slack_workspace_a",
        }),
      );
      assertPgUniqueViolation(
        duplicateActiveUserInConfigError,
        "duplicate active user principal in one provider config insert",
      );

      await insertPrincipalKey(pool, {
        id: "upk_multiple_configs_workspace_a_user_one_workspace",
        principalId: "uep_multiple_configs_workspace_a_user_one",
        keyType: "workspace_id",
        keyValue: "T_workspace_a",
      });
      await insertPrincipalKey(pool, {
        id: "upk_multiple_configs_workspace_a_user_two_workspace",
        principalId: "uep_multiple_configs_workspace_a_user_two",
        keyType: "workspace_id",
        keyValue: "T_workspace_a",
      });
      await insertPrincipalKey(pool, {
        id: "upk_multiple_configs_workspace_a_user_one_user",
        principalId: "uep_multiple_configs_workspace_a_user_one",
        keyType: "user_id",
        keyValue: "U_shared",
      });
      await insertPrincipalKey(pool, {
        id: "upk_multiple_configs_workspace_b_user_one_user",
        principalId: "uep_multiple_configs_workspace_b_user_one",
        keyType: "user_id",
        keyValue: "U_shared",
      });

      const duplicatePrincipalKeyError = await capturePgErrorCode(
        insertPrincipalKey(pool, {
          id: "upk_multiple_configs_workspace_a_user_one_duplicate_user",
          principalId: "uep_multiple_configs_workspace_a_user_one",
          keyType: "user_id",
          keyValue: "U_shared",
        }),
      );
      assertPgUniqueViolation(
        duplicatePrincipalKeyError,
        "duplicate active principal key row insert",
      );
    } finally {
      await pool.end();
    }
  });
});

async function insertIdentityLinkingFixtures(pool: Pool): Promise<void> {
  await pool.query(
    `
      insert into control_plane.organizations (id, name, slug)
      values ($1, $2, $3)
    `,
    ["org_multiple_identity_link_configs", "Multiple Identity Link Configs", "multi-ilp"],
  );
  await pool.query(
    `
      insert into control_plane.users (id, name, email)
      values ($1, $2, $3), ($4, $5, $6)
    `,
    [
      "usr_multiple_configs_one",
      "Multiple Config User One",
      "multiple-configs-one@example.com",
      "usr_multiple_configs_two",
      "Multiple Config User Two",
      "multiple-configs-two@example.com",
    ],
  );
  await pool.query(
    `
      insert into control_plane.integration_targets
        (target_key, family_id, variant_id, enabled, config)
      values ($1, $2, $3, $4, $5)
    `,
    ["slack-default-multiple-configs", "slack", "slack-default", true, {}],
  );
  await pool.query(
    `
      insert into control_plane.integration_connections
        (
          id,
          organization_id,
          target_key,
          display_name,
          status,
          external_subject_id,
          config
        )
      values
        ($1, $2, $3, $4, $5, $6, $7),
        ($8, $9, $10, $11, $12, $13, $14)
    `,
    [
      "icn_multiple_configs_slack_workspace_a",
      "org_multiple_identity_link_configs",
      "slack-default-multiple-configs",
      "Slack Workspace A",
      "active",
      "T_workspace_a",
      {},
      "icn_multiple_configs_slack_workspace_b",
      "org_multiple_identity_link_configs",
      "slack-default-multiple-configs",
      "Slack Workspace B",
      "active",
      "T_workspace_b",
      {},
    ],
  );
}

async function insertProviderConfig(
  pool: Pool,
  input: {
    id: string;
    connectionId: string;
  },
): Promise<void> {
  await pool.query(
    `
      insert into control_plane.organization_identity_link_provider_configs
        (
          id,
          organization_id,
          provider_family,
          status,
          integration_target_key,
          integration_connection_id,
          created_by_user_id,
          updated_by_user_id
        )
      values ($1, $2, $3, $4, $5, $6, $7, $8)
    `,
    [
      input.id,
      "org_multiple_identity_link_configs",
      "slack",
      "active",
      "slack-default-multiple-configs",
      input.connectionId,
      "usr_multiple_configs_one",
      "usr_multiple_configs_one",
    ],
  );
}

async function insertPrincipal(
  pool: Pool,
  input: {
    id: string;
    userId: string;
    providerSubjectId: string;
    configId: string;
    connectionId: string;
  },
): Promise<void> {
  await pool.query(
    `
      insert into control_plane.user_external_principals
        (
          id,
          organization_id,
          user_id,
          provider_family,
          provider_subject_id,
          organization_provider_config_id,
          integration_connection_id,
          status
        )
      values ($1, $2, $3, $4, $5, $6, $7, $8)
    `,
    [
      input.id,
      "org_multiple_identity_link_configs",
      input.userId,
      "slack",
      input.providerSubjectId,
      input.configId,
      input.connectionId,
      "active",
    ],
  );
}

async function insertPrincipalKey(
  pool: Pool,
  input: {
    id: string;
    principalId: string;
    keyType: string;
    keyValue: string;
  },
): Promise<void> {
  await pool.query(
    `
      insert into control_plane.user_external_principal_keys
        (id, organization_id, principal_id, provider_family, key_type, key_value, status)
      values ($1, $2, $3, $4, $5, $6, $7)
    `,
    [
      input.id,
      "org_multiple_identity_link_configs",
      input.principalId,
      "slack",
      input.keyType,
      input.keyValue,
      "active",
    ],
  );
}

async function capturePgErrorCode(query: Promise<unknown>): Promise<string | undefined> {
  try {
    await query;
    return undefined;
  } catch (error) {
    return getPgErrorCode(error);
  }
}

function getPgErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }

  return typeof error.code === "string" ? error.code : undefined;
}

function assertPgUniqueViolation(errorCode: string | undefined, context: string): void {
  if (errorCode !== "23505") {
    throw new Error(
      `Expected ${context} to fail with Postgres unique violation 23505, got '${errorCode ?? "no_error"}'.`,
    );
  }
}
