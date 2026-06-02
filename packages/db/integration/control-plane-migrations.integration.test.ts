import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getTableName, isTable } from "drizzle-orm";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { Pool } from "pg";
import { describe, expect } from "vitest";
import { z } from "zod";

import * as controlPlaneSchema from "../src/control-plane/schema/index.js";
import { CONTROL_PLANE_SCHEMA_NAME } from "../src/control-plane/schema/namespace.js";
import {
  CONTROL_PLANE_MIGRATIONS_FOLDER_PATH,
  MigrationTracking,
  runControlPlaneMigrations,
} from "../src/migrator/index.js";
import { it } from "./test-context.js";

describe("control-plane migrations integration", () => {
  it("applies control-plane migrations and can rerun safely", async ({ databaseStack }) => {
    const controlPlaneMigrationInput = {
      connectionString: databaseStack.directUrl,
      schemaName: CONTROL_PLANE_SCHEMA_NAME,
      migrationsFolder: CONTROL_PLANE_MIGRATIONS_FOLDER_PATH,
      migrationsSchema: MigrationTracking.CONTROL_PLANE.SCHEMA_NAME,
      migrationsTable: MigrationTracking.CONTROL_PLANE.TABLE_NAME,
    };

    await runControlPlaneMigrations(controlPlaneMigrationInput);

    const pool = new Pool({
      connectionString: databaseStack.directUrl,
    });

    try {
      const tablesResult = await pool.query<{ table_name: string }>(
        `
          select table_name
          from information_schema.tables
          where table_schema = $1
          order by table_name asc
        `,
        [CONTROL_PLANE_SCHEMA_NAME],
      );

      const expectedTableNames = Object.values(controlPlaneSchema)
        .flatMap((value) => (isTable(value) ? [getTableName(value)] : []))
        .sort((left, right) => left.localeCompare(right));
      const actualTableNames = tablesResult.rows
        .map((row) => row.table_name)
        .sort((left, right) => left.localeCompare(right));
      expect(actualTableNames).toEqual(expectedTableNames);

      const expectedMigrationCount = readMigrationFiles({
        migrationsFolder: controlPlaneMigrationInput.migrationsFolder,
      }).length;
      const migrationTableRowCountQuery = `select count(*)::int as migration_count from "${controlPlaneMigrationInput.migrationsSchema}"."${controlPlaneMigrationInput.migrationsTable}"`;

      const migrationRowsAfterFirstRunResult = await pool.query<{ migration_count: number }>(
        migrationTableRowCountQuery,
      );
      expect(migrationRowsAfterFirstRunResult.rows[0]?.migration_count).toBe(
        expectedMigrationCount,
      );

      await runControlPlaneMigrations(controlPlaneMigrationInput);

      const migrationRowsResult = await pool.query<{ migration_count: number }>(
        migrationTableRowCountQuery,
      );
      expect(migrationRowsResult.rows[0]?.migration_count).toBe(expectedMigrationCount);
    } finally {
      await pool.end();
    }
  }, 60_000);

  it("renames legacy trigger data without losing scheduled actions or conversations", async ({
    databaseStack,
  }) => {
    const schemaName = "control_plane_trigger_rename";
    const migrationTrackingSchemaName = "control_plane_trigger_rename_meta";
    const previousMigrationsFolder = await createControlPlaneMigrationsFolderBeforeTriggerRename();
    const migrationInput = {
      connectionString: databaseStack.directUrl,
      schemaName,
      migrationsFolder: previousMigrationsFolder,
      migrationsSchema: migrationTrackingSchemaName,
      migrationsTable: MigrationTracking.CONTROL_PLANE.TABLE_NAME,
    };
    const pool = new Pool({
      connectionString: databaseStack.directUrl,
    });

    try {
      await runControlPlaneMigrations(migrationInput);
      await seedLegacyTriggerRenameRows({ pool, schemaName });

      await runControlPlaneMigrations({
        ...migrationInput,
        migrationsFolder: CONTROL_PLANE_MIGRATIONS_FOLDER_PATH,
      });

      const renamedRows = await pool.query<{
        schedule_target_type: string;
        action_target_type: string;
        trigger_id: string | null;
        legacy_camel_trigger_id: string | null;
        legacy_snake_trigger_id: string | null;
        webhook_trigger_id: string | null;
        owner_kind: string;
        run_trigger_id: string;
        run_target_id: string | null;
        delivery_trigger_run_id: string;
        api_key_permissions: string[];
      }>(
        `
          select
            schedules.target_type as schedule_target_type,
            scheduled_actions.target_type as action_target_type,
            scheduled_actions.target_payload->>'triggerId' as trigger_id,
            scheduled_actions.target_payload->>'automationId' as legacy_camel_trigger_id,
            scheduled_actions.target_payload->>'automation_id' as legacy_snake_trigger_id,
            webhook_triggers.trigger_id as webhook_trigger_id,
            trigger_conversations.owner_kind,
            trigger_runs.trigger_id as run_trigger_id,
            trigger_runs.trigger_target_id as run_target_id,
            trigger_conversation_delivery_tasks.trigger_run_id as delivery_trigger_run_id,
            array(
              select api_key_permissions.permission
              from control_plane.api_key_permissions
              where api_key_permissions.api_key_id = 'apk_trigger_rename_legacy'
              order by api_key_permissions.permission asc
            ) as api_key_permissions
          from control_plane.schedules
          join control_plane.scheduled_actions
            on scheduled_actions.schedule_id = schedules.id
            and scheduled_actions.id = 'sca_trigger_rename_legacy'
          join control_plane.webhook_triggers
            on webhook_triggers.trigger_id = 'atm_trigger_rename_legacy'
          join control_plane.trigger_runs
            on trigger_runs.source_scheduled_action_id = scheduled_actions.id
          join control_plane.trigger_conversations
            on trigger_conversations.id = trigger_runs.conversation_id
          join control_plane.trigger_conversation_delivery_tasks
            on trigger_conversation_delivery_tasks.trigger_run_id = trigger_runs.id
          where schedules.id = 'sch_trigger_rename_legacy'
        `.replaceAll("control_plane.", `${quoteSqlIdentifier(schemaName)}.`),
      );
      expect(renamedRows.rows).toEqual([
        {
          schedule_target_type: "trigger_run",
          action_target_type: "trigger_run",
          trigger_id: "atm_trigger_rename_legacy",
          legacy_camel_trigger_id: null,
          legacy_snake_trigger_id: null,
          webhook_trigger_id: "atm_trigger_rename_legacy",
          owner_kind: "trigger_target",
          run_trigger_id: "atm_trigger_rename_legacy",
          run_target_id: "atg_trigger_rename_legacy",
          delivery_trigger_run_id: "aru_trigger_rename_legacy",
          api_key_permissions: [
            "apiKey:read",
            "triggerWebhook:create",
            "triggerWebhook:delete",
            "triggerWebhook:read",
            "triggerWebhook:update",
          ],
        },
      ]);

      const snakePayloadRows = await pool.query<{
        trigger_id: string | null;
        legacy_camel_trigger_id: string | null;
        legacy_snake_trigger_id: string | null;
      }>(
        `
          select
            target_payload->>'triggerId' as trigger_id,
            target_payload->>'automationId' as legacy_camel_trigger_id,
            target_payload->>'automation_id' as legacy_snake_trigger_id
          from control_plane.scheduled_actions
          where id = 'sca_trigger_rename_legacy_snake'
        `.replaceAll("control_plane.", `${quoteSqlIdentifier(schemaName)}.`),
      );
      expect(snakePayloadRows.rows).toEqual([
        {
          trigger_id: "atm_trigger_rename_legacy",
          legacy_camel_trigger_id: null,
          legacy_snake_trigger_id: null,
        },
      ]);

      const oldTableResult = await pool.query<{ old_table_name: string | null }>(
        `select to_regclass('${schemaName}.automations')::text as old_table_name`,
      );
      expect(oldTableResult.rows[0]?.old_table_name).toBeNull();
    } finally {
      await pool.query(`drop schema if exists ${quoteSqlIdentifier(schemaName)} cascade`);
      await pool.query(
        `drop schema if exists ${quoteSqlIdentifier(migrationTrackingSchemaName)} cascade`,
      );
      await pool.end();
      await rm(previousMigrationsFolder, { recursive: true, force: true });
    }
  }, 60_000);
});

const MigrationJournalSchema = z.object({
  version: z.string(),
  dialect: z.string(),
  entries: z.array(
    z
      .object({
        idx: z.number(),
        version: z.string(),
        when: z.number(),
        tag: z.string(),
        breakpoints: z.boolean(),
      })
      .loose(),
  ),
});

async function createControlPlaneMigrationsFolderBeforeTriggerRename(): Promise<string> {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "mistle-control-plane-migrations-"));
  await cp(CONTROL_PLANE_MIGRATIONS_FOLDER_PATH, temporaryDirectory, { recursive: true });

  const journalPath = join(temporaryDirectory, "meta", "_journal.json");
  const journal = MigrationJournalSchema.parse(JSON.parse(await readFile(journalPath, "utf8")));
  const triggerRenameEntryIndex = journal.entries.findIndex(
    (entry) => entry.tag === "0032_rename-automation-to-trigger",
  );
  if (triggerRenameEntryIndex === -1) {
    throw new Error("Could not find trigger rename migration entry.");
  }

  const removedEntries = journal.entries.slice(triggerRenameEntryIndex);
  for (const entry of removedEntries) {
    await rm(join(temporaryDirectory, `${entry.tag}.sql`), { force: true });
    await rm(
      join(temporaryDirectory, "meta", `${entry.idx.toString().padStart(4, "0")}_snapshot.json`),
      {
        force: true,
      },
    );
  }

  const previousJournal = {
    ...journal,
    entries: journal.entries.slice(0, triggerRenameEntryIndex),
  };
  await writeFile(journalPath, `${JSON.stringify(previousJournal, null, 2)}\n`);

  return temporaryDirectory;
}

async function seedLegacyTriggerRenameRows(input: {
  pool: Pool;
  schemaName: string;
}): Promise<void> {
  const { pool } = input;
  const schemaName = quoteSqlIdentifier(input.schemaName);
  await pool.query(
    `
      insert into ${schemaName}.organizations (id, name, slug)
      values ('org_trigger_rename', 'Trigger Rename', 'trigger-rename')
    `,
  );
  await pool.query(
    `
      insert into ${schemaName}.api_keys (
        id,
        name,
        organization_id,
        secret_prefix,
        secret_hash,
        secret_hash_algorithm,
        created_by_actor_kind,
        created_by_actor_id
      )
      values (
        'apk_trigger_rename_legacy',
        'Legacy API key',
        'org_trigger_rename',
        'trigger_rename',
        'not-a-real-hash',
        'sha256_v1',
        'user',
        'usr_trigger_rename'
      )
    `,
  );
  await pool.query(
    `
      insert into ${schemaName}.api_key_permissions (api_key_id, permission)
      values
        ('apk_trigger_rename_legacy', 'automationWebhook:read'),
        ('apk_trigger_rename_legacy', 'automationWebhook:create'),
        ('apk_trigger_rename_legacy', 'automationWebhook:update'),
        ('apk_trigger_rename_legacy', 'automationWebhook:delete'),
        ('apk_trigger_rename_legacy', 'apiKey:read')
    `,
  );
  await pool.query(
    `
      insert into ${schemaName}.integration_targets
        (target_key, family_id, variant_id, config)
      values ('github_default', 'github', 'github-default', '{}'::jsonb)
    `,
  );
  await pool.query(
    `
      insert into ${schemaName}.integration_connections
        (id, organization_id, target_key, display_name)
      values (
        'icn_trigger_rename_legacy',
        'org_trigger_rename',
        'github_default',
        'Legacy GitHub connection'
      )
    `,
  );
  await pool.query(
    `
      insert into ${schemaName}.integration_webhook_sources
        (
          id,
          organization_id,
          integration_connection_id,
          target_key,
          endpoint_key
        )
      values (
        'iws_trigger_rename_legacy',
        'org_trigger_rename',
        'icn_trigger_rename_legacy',
        'github_default',
        'trigger-rename-legacy'
      )
    `,
  );
  await pool.query(
    `
      insert into ${schemaName}.sandbox_profiles (id, organization_id, display_name)
      values ('sbp_trigger_rename', 'org_trigger_rename', 'Trigger Rename Profile')
    `,
  );
  await pool.query(
    `
      insert into ${schemaName}.schedules
        (id, organization_id, target_type, name, cron_expression, timezone, enabled)
      values (
        'sch_trigger_rename_legacy',
        'org_trigger_rename',
        'automation_run',
        'Legacy trigger rename schedule',
        '0 9 * * *',
        'UTC',
        true
      )
    `,
  );
  await pool.query(
    `
      insert into ${schemaName}.automations (id, organization_id, kind, name, enabled)
      values ('atm_trigger_rename_legacy', 'org_trigger_rename', 'schedule', 'Legacy trigger', true)
    `,
  );
  await pool.query(
    `
      insert into ${schemaName}.automation_targets
        (id, automation_id, sandbox_profile_id, sandbox_profile_version)
      values (
        'atg_trigger_rename_legacy',
        'atm_trigger_rename_legacy',
        'sbp_trigger_rename',
        1
      )
    `,
  );
  await pool.query(
    `
      insert into ${schemaName}.schedule_automations
        (schedule_id, automation_id, input_template, conversation_key_template)
      values (
        'sch_trigger_rename_legacy',
        'atm_trigger_rename_legacy',
        'hello',
        'conversation-{{schedule.id}}'
      )
    `,
  );
  await pool.query(
    `
      insert into ${schemaName}.webhook_automations
        (
          automation_id,
          integration_webhook_source_id,
          input_template,
          conversation_key_template
        )
      values (
        'atm_trigger_rename_legacy',
        'iws_trigger_rename_legacy',
        'hello webhook',
        'conversation-{{event.id}}'
      )
    `,
  );
  await pool.query(
    `
      insert into ${schemaName}.scheduled_actions
        (
          id,
          schedule_id,
          organization_id,
          target_type,
          target_payload,
          scheduled_at,
          local_scheduled_date,
          local_scheduled_time
        )
      values (
        'sca_trigger_rename_legacy',
        'sch_trigger_rename_legacy',
        'org_trigger_rename',
        'automation_run',
        '{"automationId":"atm_trigger_rename_legacy"}'::jsonb,
        '2026-05-18T01:00:00.000Z',
        '2026-05-18',
        '09:00'
      )
    `,
  );
  await pool.query(
    `
      insert into ${schemaName}.scheduled_actions
        (
          id,
          schedule_id,
          organization_id,
          target_type,
          target_payload,
          scheduled_at,
          local_scheduled_date,
          local_scheduled_time
        )
      values (
        'sca_trigger_rename_legacy_snake',
        'sch_trigger_rename_legacy',
        'org_trigger_rename',
        'automation_run',
        '{"automation_id":"atm_trigger_rename_legacy"}'::jsonb,
        '2026-05-18T02:00:00.000Z',
        '2026-05-18',
        '10:00'
      )
    `,
  );
  await pool.query(
    `
      insert into ${schemaName}.automation_conversations
        (
          id,
          organization_id,
          owner_kind,
          owner_id,
          created_by_kind,
          created_by_id,
          sandbox_profile_id,
          integration_family_id,
          runtime_id,
          conversation_key,
          status
        )
      values (
        'cnv_trigger_rename_legacy',
        'org_trigger_rename',
        'automation_target',
        'atg_trigger_rename_legacy',
        'schedule',
        'atm_trigger_rename_legacy',
        'sbp_trigger_rename',
        'github',
        'codex',
        'conversation-sch_trigger_rename_legacy',
        'active'
      )
    `,
  );
  await pool.query(
    `
      insert into ${schemaName}.automation_runs
        (
          id,
          automation_id,
          automation_target_id,
          source_scheduled_action_id,
          conversation_id,
          status
        )
      values (
        'aru_trigger_rename_legacy',
        'atm_trigger_rename_legacy',
        'atg_trigger_rename_legacy',
        'sca_trigger_rename_legacy',
        'cnv_trigger_rename_legacy',
        'queued'
      )
    `,
  );
  await pool.query(
    `
      insert into ${schemaName}.automation_conversation_delivery_tasks
        (
          id,
          conversation_id,
          automation_run_id,
          source_scheduled_action_id,
          source_order_key
        )
      values (
        'cdt_trigger_rename_legacy',
        'cnv_trigger_rename_legacy',
        'aru_trigger_rename_legacy',
        'sca_trigger_rename_legacy',
        'schedule:sca_trigger_rename_legacy'
      )
    `,
  );
}

function quoteSqlIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}
