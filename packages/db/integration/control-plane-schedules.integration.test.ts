import { Pool } from "pg";
import { describe } from "vitest";

import { CONTROL_PLANE_SCHEMA_NAME } from "../src/control-plane/schema/namespace.js";
import {
  CONTROL_PLANE_MIGRATIONS_FOLDER_PATH,
  MigrationTracking,
  runControlPlaneMigrations,
} from "../src/migrator/index.js";
import { it } from "./test-context.js";

describe("control-plane schedules integration", () => {
  it("enforces schedule action uniqueness and source links", async ({ databaseStack }) => {
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
      await insertScheduleTestFixtures(pool);

      await pool.query(
        `
          insert into control_plane.schedules
            (
              id,
              organization_id,
              target_type,
              name,
              cron_expression,
              timezone,
              enabled,
              next_scheduled_at
            )
          values ($1, $2, $3, $4, $5, $6, $7, $8)
        `,
        [
          "sch_schedule_test_automation",
          "org_schedule_test",
          "automation_run",
          "Schedule Test Automation",
          "0 9 * * *",
          "Asia/Singapore",
          true,
          "2026-04-28T01:00:00.000Z",
        ],
      );
      await pool.query(
        `
          insert into control_plane.schedules
            (
              id,
              organization_id,
              target_type,
              name,
              cron_expression,
              timezone,
              enabled,
              next_scheduled_at
            )
          values ($1, $2, $3, $4, $5, $6, $7, $8)
        `,
        [
          "sch_schedule_test_snapshot",
          "org_schedule_test",
          "sandbox_profile_snapshot_refresh",
          "Schedule Test Snapshot",
          "0 9 * * *",
          "Asia/Singapore",
          true,
          "2026-04-28T01:00:00.000Z",
        ],
      );
      await pool.query(
        `
          insert into control_plane.schedules
            (id, organization_id, target_type, name, cron_expression, timezone, enabled)
          values ($1, $2, $3, $4, $5, $6, $7)
        `,
        [
          "sch_schedule_test_disabled",
          "org_schedule_test",
          "automation_run",
          "Disabled Schedule",
          "0 9 * * *",
          "Asia/Singapore",
          false,
        ],
      );

      await pool.query(
        `
          insert into control_plane.schedule_automations
            (
              schedule_id,
              automation_id,
              input_template,
              conversation_key_template,
              idempotency_key_template
            )
          values ($1, $2, $3, $4, $5)
        `,
        [
          "sch_schedule_test_automation",
          "atm_schedule_test",
          "{}",
          "conversation-{{schedule.id}}",
          "idempotency-{{scheduled_action.id}}",
        ],
      );
      await pool.query(
        `
          insert into control_plane.schedules
            (
              id,
              organization_id,
              target_type,
              name,
              cron_expression,
              timezone,
              enabled,
              next_scheduled_at
            )
          values ($1, $2, $3, $4, $5, $6, $7, $8)
        `,
        [
          "sch_schedule_test_duplicate_automation",
          "org_schedule_test",
          "automation_run",
          "Duplicate Automation Schedule",
          "0 10 * * *",
          "Asia/Singapore",
          true,
          "2026-04-28T02:00:00.000Z",
        ],
      );
      const duplicateScheduleAutomationError = await capturePgErrorCode(
        pool.query(
          `
            insert into control_plane.schedule_automations
              (
                schedule_id,
                automation_id,
                input_template,
                conversation_key_template
              )
            values ($1, $2, $3, $4)
          `,
          [
            "sch_schedule_test_duplicate_automation",
            "atm_schedule_test",
            "{}",
            "conversation-{{schedule.id}}",
          ],
        ),
      );
      assertPgUniqueViolation(
        duplicateScheduleAutomationError,
        "duplicate schedule automation automation_id insert",
      );
      await pool.query(
        `
          insert into control_plane.sandbox_profile_snapshot_refresh_schedule_targets
            (schedule_id, sandbox_profile_id, sandbox_profile_version)
          values ($1, $2, $3)
        `,
        ["sch_schedule_test_snapshot", "sbp_schedule_test", 1],
      );

      await insertScheduledAction(pool, {
        id: "sca_schedule_test_one",
        scheduleId: "sch_schedule_test_automation",
        scheduledAt: "2026-04-28T01:00:00.000Z",
        localDate: "2026-04-28",
        localTime: "09:00",
      });

      const duplicateScheduledAtError = await capturePgErrorCode(
        pool.query(
          `
            insert into control_plane.scheduled_actions
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
            values ($1, $2, $3, $4, $5, $6, $7, $8)
          `,
          [
            "sca_schedule_test_duplicate_utc",
            "sch_schedule_test_automation",
            "org_schedule_test",
            "automation_run",
            { automation_id: "atm_schedule_test" },
            "2026-04-28T01:00:00.000Z",
            "2026-04-28",
            "10:00",
          ],
        ),
      );
      assertPgUniqueViolation(duplicateScheduledAtError, "duplicate scheduled_at insert");

      const duplicateLocalSlotError = await capturePgErrorCode(
        pool.query(
          `
            insert into control_plane.scheduled_actions
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
            values ($1, $2, $3, $4, $5, $6, $7, $8)
          `,
          [
            "sca_schedule_test_duplicate_local",
            "sch_schedule_test_automation",
            "org_schedule_test",
            "automation_run",
            { automation_id: "atm_schedule_test" },
            "2026-04-28T02:00:00.000Z",
            "2026-04-28",
            "09:00",
          ],
        ),
      );
      assertPgUniqueViolation(duplicateLocalSlotError, "duplicate local scheduled slot insert");

      await insertScheduledAction(pool, {
        id: "sca_schedule_test_two",
        scheduleId: "sch_schedule_test_snapshot",
        targetType: "sandbox_profile_snapshot_refresh",
        targetPayload: {
          sandbox_profile_id: "sbp_schedule_test",
          sandbox_profile_version: 1,
        },
        scheduledAt: "2026-04-28T01:00:00.000Z",
        localDate: "2026-04-28",
        localTime: "09:00",
      });

      await pool.query(
        `
          insert into control_plane.automation_runs
            (id, automation_id, source_scheduled_action_id)
          values ($1, $2, $3)
        `,
        ["aru_schedule_test_one", "atm_schedule_test", "sca_schedule_test_one"],
      );
      await pool.query(
        `
          insert into control_plane.automation_runs
            (id, automation_id)
          values ($1, $2), ($3, $4)
        `,
        [
          "aru_schedule_test_null_one",
          "atm_schedule_test",
          "aru_schedule_test_null_two",
          "atm_schedule_test",
        ],
      );

      const duplicateAutomationRunSourceError = await capturePgErrorCode(
        pool.query(
          `
            insert into control_plane.automation_runs
              (id, automation_id, source_scheduled_action_id)
            values ($1, $2, $3)
          `,
          ["aru_schedule_test_two", "atm_schedule_test", "sca_schedule_test_one"],
        ),
      );
      assertPgUniqueViolation(
        duplicateAutomationRunSourceError,
        "duplicate automation run scheduled action source insert",
      );

      await pool.query(
        `
          insert into control_plane.sandbox_profile_version_snapshot_jobs
            (
              id,
              sandbox_profile_id,
              sandbox_profile_version,
              source_scheduled_action_id,
              trigger,
              state
            )
          values ($1, $2, $3, $4, $5, $6)
        `,
        [
          "ssj_schedule_test_one",
          "sbp_schedule_test",
          1,
          "sca_schedule_test_two",
          "scheduled_refresh",
          "failed",
        ],
      );

      const duplicateSnapshotJobSourceError = await capturePgErrorCode(
        pool.query(
          `
            insert into control_plane.sandbox_profile_version_snapshot_jobs
              (
                id,
                sandbox_profile_id,
                sandbox_profile_version,
                source_scheduled_action_id,
                trigger,
                state
              )
            values ($1, $2, $3, $4, $5, $6)
          `,
          [
            "ssj_schedule_test_two",
            "sbp_schedule_test",
            1,
            "sca_schedule_test_two",
            "scheduled_refresh",
            "failed",
          ],
        ),
      );
      assertPgUniqueViolation(
        duplicateSnapshotJobSourceError,
        "duplicate snapshot job scheduled action source insert",
      );

      await pool.query(
        `
          insert into control_plane.automation_conversations
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
          values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        `,
        [
          "cnv_schedule_test",
          "org_schedule_test",
          "automation_target",
          "atg_schedule_test",
          "schedule",
          "atm_schedule_test",
          "sbp_schedule_test",
          "openai",
          "codex",
          "schedule-test",
          "active",
        ],
      );
      await pool.query(
        `
          insert into control_plane.automation_targets
            (id, automation_id, sandbox_profile_id, sandbox_profile_version)
          values ($1, $2, $3, $4)
        `,
        ["atg_schedule_test", "atm_schedule_test", "sbp_schedule_test", 1],
      );
      await pool.query(
        `
          insert into control_plane.automation_runs
            (id, automation_id, automation_target_id, conversation_id)
          values ($1, $2, $3, $4)
        `,
        [
          "aru_schedule_test_delivery",
          "atm_schedule_test",
          "atg_schedule_test",
          "cnv_schedule_test",
        ],
      );
      await pool.query(
        `
          insert into control_plane.automation_conversation_delivery_tasks
            (
              id,
              conversation_id,
              automation_run_id,
              source_scheduled_action_id,
              source_order_key
            )
          values ($1, $2, $3, $4, $5)
        `,
        [
          "cdt_schedule_test_scheduled_source",
          "cnv_schedule_test",
          "aru_schedule_test_delivery",
          "sca_schedule_test_one",
          "2026-04-28T01:00:00.000Z:sca_schedule_test_one",
        ],
      );

      await pool.query(
        `
          insert into control_plane.automation_runs
            (id, automation_id, automation_target_id, conversation_id)
          values ($1, $2, $3, $4), ($5, $6, $7, $8)
        `,
        [
          "aru_schedule_test_delivery_without_source",
          "atm_schedule_test",
          "atg_schedule_test",
          "cnv_schedule_test",
          "aru_schedule_test_delivery_with_two_sources",
          "atm_schedule_test",
          "atg_schedule_test",
          "cnv_schedule_test",
        ],
      );
      const deliveryTaskWithoutSourceError = await capturePgErrorCode(
        pool.query(
          `
            insert into control_plane.automation_conversation_delivery_tasks
              (id, conversation_id, automation_run_id, source_order_key)
            values ($1, $2, $3, $4)
          `,
          [
            "cdt_schedule_test_no_source",
            "cnv_schedule_test",
            "aru_schedule_test_delivery_without_source",
            "2026-04-28T01:00:00.000Z:no_source",
          ],
        ),
      );
      assertPgCheckViolation(
        deliveryTaskWithoutSourceError,
        "delivery task without a source insert",
      );

      await insertWebhookDeliverySourceFixtures(pool);
      const deliveryTaskWithTwoSourcesError = await capturePgErrorCode(
        pool.query(
          `
            insert into control_plane.automation_conversation_delivery_tasks
              (
                id,
                conversation_id,
                automation_run_id,
                source_webhook_event_id,
                source_scheduled_action_id,
                source_order_key
              )
            values ($1, $2, $3, $4, $5, $6)
          `,
          [
            "cdt_schedule_test_two_sources",
            "cnv_schedule_test",
            "aru_schedule_test_delivery_with_two_sources",
            "iwe_schedule_test",
            "sca_schedule_test_one",
            "2026-04-28T01:00:00.000Z:two_sources",
          ],
        ),
      );
      assertPgCheckViolation(
        deliveryTaskWithTwoSourcesError,
        "delivery task with two sources insert",
      );

      const scheduleAutomationColumnsResult = await pool.query<{ column_name: string }>(
        `
          select column_name
          from information_schema.columns
          where table_schema = 'control_plane'
            and table_name = 'schedule_automations'
          order by ordinal_position
        `,
      );
      assertStringArraysEqual(
        scheduleAutomationColumnsResult.rows.map((row) => row.column_name),
        [
          "automation_id",
          "input_template",
          "conversation_key_template",
          "idempotency_key_template",
          "created_at",
          "updated_at",
          "schedule_id",
        ],
      );
    } finally {
      await pool.end();
    }
  });
});

async function insertScheduleTestFixtures(pool: Pool): Promise<void> {
  await pool.query(
    `
      insert into control_plane.organizations (id, name, slug)
      values ($1, $2, $3)
    `,
    ["org_schedule_test", "Schedule Test Org", "schedule-test-org"],
  );
  await pool.query(
    `
      insert into control_plane.automations (id, organization_id, kind, name)
      values ($1, $2, $3, $4)
    `,
    ["atm_schedule_test", "org_schedule_test", "schedule", "Schedule Test Automation"],
  );
  await pool.query(
    `
      insert into control_plane.sandbox_profiles (id, organization_id, display_name, status)
      values ($1, $2, $3, $4)
    `,
    ["sbp_schedule_test", "org_schedule_test", "Schedule Test Profile", "active"],
  );
  await pool.query(
    `
      insert into control_plane.sandbox_profile_versions
        (sandbox_profile_id, version, state, published_at)
      values ($1, $2, $3, $4)
    `,
    ["sbp_schedule_test", 1, "published", "2026-04-01T00:00:00.000Z"],
  );
}

async function insertWebhookDeliverySourceFixtures(pool: Pool): Promise<void> {
  await pool.query(
    `
      insert into control_plane.integration_targets
        (target_key, family_id, variant_id, enabled, config)
      values ($1, $2, $3, $4, $5)
    `,
    [
      "github-cloud-schedule-test",
      "github",
      "github-cloud",
      true,
      {
        api_base_url: "https://api.github.com",
        web_base_url: "https://github.com",
      },
    ],
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
      values ($1, $2, $3, $4, $5, $6, $7)
    `,
    [
      "icn_schedule_test",
      "org_schedule_test",
      "github-cloud-schedule-test",
      "Schedule Test Connection",
      "active",
      "subject-schedule-test",
      {},
    ],
  );
  await pool.query(
    `
      insert into control_plane.integration_webhook_sources
        (
          id,
          organization_id,
          integration_connection_id,
          target_key,
          endpoint_key,
          status
        )
      values ($1, $2, $3, $4, $5, $6)
    `,
    [
      "iws_schedule_test",
      "org_schedule_test",
      "icn_schedule_test",
      "github-cloud-schedule-test",
      "endpoint-schedule-test",
      "active",
    ],
  );
  await pool.query(
    `
      insert into control_plane.integration_webhook_events
        (
          id,
          organization_id,
          integration_connection_id,
          integration_webhook_source_id,
          target_key,
          external_event_id,
          provider_event_type,
          event_type,
          payload,
          status
        )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    `,
    [
      "iwe_schedule_test",
      "org_schedule_test",
      "icn_schedule_test",
      "iws_schedule_test",
      "github-cloud-schedule-test",
      "evt-schedule-test",
      "issue_comment",
      "github.issue_comment.created",
      {},
      "processed",
    ],
  );
}

async function insertScheduledAction(
  pool: Pool,
  input: {
    id: string;
    scheduleId: string;
    scheduledAt: string;
    localDate: string;
    localTime: string;
    targetType?: string;
    targetPayload?: Record<string, unknown>;
  },
): Promise<void> {
  await pool.query(
    `
      insert into control_plane.scheduled_actions
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
      values ($1, $2, $3, $4, $5, $6, $7, $8)
    `,
    [
      input.id,
      input.scheduleId,
      "org_schedule_test",
      input.targetType ?? "automation_run",
      input.targetPayload ?? { automation_id: "atm_schedule_test" },
      input.scheduledAt,
      input.localDate,
      input.localTime,
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

function assertPgCheckViolation(errorCode: string | undefined, context: string): void {
  if (errorCode !== "23514") {
    throw new Error(
      `Expected ${context} to fail with Postgres check violation 23514, got '${errorCode ?? "no_error"}'.`,
    );
  }
}

function assertStringArraysEqual(actual: readonly string[], expected: readonly string[]): void {
  if (
    actual.length !== expected.length ||
    actual.some((actualValue, index) => actualValue !== expected[index])
  ) {
    throw new Error(
      `Expected string arrays to match.\nActual: ${JSON.stringify(actual)}\nExpected: ${JSON.stringify(expected)}`,
    );
  }
}
