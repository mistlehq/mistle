import { describe, expect, it } from "vitest";

import { AutomationsListResultSchema } from "./automations-types.js";

describe("AutomationsListResultSchema", () => {
  it("parses mixed event and schedule automations", () => {
    const parsed = AutomationsListResultSchema.parse({
      items: [
        {
          id: "atm_webhook_123",
          kind: "webhook",
          name: "Review events",
          enabled: true,
          target: {
            sandboxProfileId: "sbp_repo_maintainer",
            sandboxProfileName: "Repo Maintainer",
            primaryRepositoryId: "mistlehq/platform",
            primaryRepositoryName: "mistlehq/platform",
          },
          source: {
            kind: "webhook",
            events: [
              {
                label: "Issue comment created",
                logoKey: "github",
              },
            ],
          },
          updatedAt: "2026-04-30T02:00:00.000Z",
        },
        {
          id: "atm_schedule_123",
          kind: "schedule",
          name: "Daily triage",
          enabled: false,
          target: {
            sandboxProfileId: "sbp_repo_maintainer",
            sandboxProfileName: "Repo Maintainer",
            primaryRepositoryId: null,
            primaryRepositoryName: null,
          },
          issue: {
            code: "MISSING_SANDBOX_PROFILE",
            message: "Sandbox profile is missing.",
          },
          source: {
            kind: "schedule",
            cronExpression: "0 9 * * 1-5",
            timezone: "Asia/Singapore",
            nextScheduledAt: null,
          },
          updatedAt: "2026-04-30T03:00:00.000Z",
        },
      ],
      nextPage: null,
      previousPage: null,
      totalResults: 2,
    });

    expect(parsed.items).toHaveLength(2);
  });
});
