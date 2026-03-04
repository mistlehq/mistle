import {
  automationTargets,
  automations,
  AutomationKinds,
  integrationConnections,
  IntegrationConnectionStatuses,
  integrationTargets,
  sandboxProfiles,
  webhookAutomations,
} from "@mistle/db/control-plane";
import { describe, expect } from "vitest";

import { resolveWebhookAutomationTargets } from "../src/automations/services/resolve-webhook-automation-targets.js";
import { it, type ControlPlaneApiIntegrationFixture } from "./test-context.js";

const TestTimeoutMs = 120_000;

async function insertTargetAndConnection(input: {
  fixture: ControlPlaneApiIntegrationFixture;
  targetKey: string;
  connectionId: string;
  organizationId: string;
}): Promise<void> {
  await input.fixture.db.insert(integrationTargets).values({
    targetKey: input.targetKey,
    familyId: "github",
    variantId: "github-cloud",
    enabled: true,
    config: {
      api_base_url: "https://api.github.com",
      web_base_url: "https://github.com",
    },
  });

  await input.fixture.db.insert(integrationConnections).values({
    id: input.connectionId,
    organizationId: input.organizationId,
    targetKey: input.targetKey,
    status: IntegrationConnectionStatuses.ACTIVE,
    externalSubjectId: "123456",
  });
}

async function insertSandboxProfile(input: {
  fixture: ControlPlaneApiIntegrationFixture;
  profileId: string;
  organizationId: string;
  displayName: string;
}): Promise<void> {
  await input.fixture.db.insert(sandboxProfiles).values({
    id: input.profileId,
    organizationId: input.organizationId,
    displayName: input.displayName,
    status: "active",
  });
}

describe("resolve webhook automation targets integration", () => {
  it(
    "resolves a webhook automation target when event type and payload filter match",
    async ({ fixture }) => {
      const session = await fixture.authSession({
        email: "integration-resolve-webhook-automation-match@example.com",
      });
      const targetKey = "github-cloud-resolver-match";
      const connectionId = "icn_resolver_match";

      await insertTargetAndConnection({
        fixture,
        targetKey,
        connectionId,
        organizationId: session.organizationId,
      });
      await insertSandboxProfile({
        fixture,
        profileId: "sbp_resolver_match",
        organizationId: session.organizationId,
        displayName: "Resolver Match Profile",
      });
      await fixture.db.insert(automations).values({
        id: "atm_resolver_match",
        organizationId: session.organizationId,
        kind: AutomationKinds.WEBHOOK,
        name: "Issue Comment Matches",
        enabled: true,
      });
      await fixture.db.insert(webhookAutomations).values({
        automationId: "atm_resolver_match",
        integrationConnectionId: connectionId,
        eventTypes: ["github.issue_comment.created"],
        payloadFilter: {
          op: "contains",
          path: ["comment", "body"],
          value: "@mistlebot",
        },
        inputTemplate: "Handle issue comment webhook",
        conversationKeyTemplate: "github/{{installation.id}}",
        idempotencyKeyTemplate: "{{delivery.id}}",
      });
      await fixture.db.insert(automationTargets).values({
        id: "atg_resolver_match",
        automationId: "atm_resolver_match",
        sandboxProfileId: "sbp_resolver_match",
        sandboxProfileVersion: 3,
      });

      const resolvedTargets = await resolveWebhookAutomationTargets(fixture.db, {
        organizationId: session.organizationId,
        integrationConnectionId: connectionId,
        eventType: "github.issue_comment.created",
        payload: {
          comment: {
            body: "please run @mistlebot",
          },
        },
      });

      expect(resolvedTargets).toEqual([
        {
          automationId: "atm_resolver_match",
          automationName: "Issue Comment Matches",
          automationTargetId: "atg_resolver_match",
          sandboxProfileId: "sbp_resolver_match",
          sandboxProfileVersion: 3,
          inputTemplate: "Handle issue comment webhook",
          conversationKeyTemplate: "github/{{installation.id}}",
          idempotencyKeyTemplate: "{{delivery.id}}",
        },
      ]);
    },
    TestTimeoutMs,
  );

  it(
    "returns no targets when configured event types do not include the incoming event",
    async ({ fixture }) => {
      const session = await fixture.authSession({
        email: "integration-resolve-webhook-automation-event-mismatch@example.com",
      });
      const targetKey = "github-cloud-resolver-event-mismatch";
      const connectionId = "icn_resolver_event_mismatch";

      await insertTargetAndConnection({
        fixture,
        targetKey,
        connectionId,
        organizationId: session.organizationId,
      });
      await insertSandboxProfile({
        fixture,
        profileId: "sbp_resolver_event_mismatch",
        organizationId: session.organizationId,
        displayName: "Resolver Event Mismatch Profile",
      });
      await fixture.db.insert(automations).values({
        id: "atm_resolver_event_mismatch",
        organizationId: session.organizationId,
        kind: AutomationKinds.WEBHOOK,
        name: "Pull Request Opened",
        enabled: true,
      });
      await fixture.db.insert(webhookAutomations).values({
        automationId: "atm_resolver_event_mismatch",
        integrationConnectionId: connectionId,
        eventTypes: ["github.pull_request.opened"],
        payloadFilter: null,
        inputTemplate: "Handle pull request opened",
        conversationKeyTemplate: "github/pr/{{pull_request.id}}",
        idempotencyKeyTemplate: null,
      });
      await fixture.db.insert(automationTargets).values({
        id: "atg_resolver_event_mismatch",
        automationId: "atm_resolver_event_mismatch",
        sandboxProfileId: "sbp_resolver_event_mismatch",
        sandboxProfileVersion: null,
      });

      const resolvedTargets = await resolveWebhookAutomationTargets(fixture.db, {
        organizationId: session.organizationId,
        integrationConnectionId: connectionId,
        eventType: "github.issue_comment.created",
        payload: {
          comment: {
            body: "hello",
          },
        },
      });

      expect(resolvedTargets).toEqual([]);
    },
    TestTimeoutMs,
  );

  it(
    "returns no targets when payload filter does not match",
    async ({ fixture }) => {
      const session = await fixture.authSession({
        email: "integration-resolve-webhook-automation-payload-mismatch@example.com",
      });
      const targetKey = "github-cloud-resolver-payload-mismatch";
      const connectionId = "icn_resolver_payload_mismatch";

      await insertTargetAndConnection({
        fixture,
        targetKey,
        connectionId,
        organizationId: session.organizationId,
      });
      await insertSandboxProfile({
        fixture,
        profileId: "sbp_resolver_payload_mismatch",
        organizationId: session.organizationId,
        displayName: "Resolver Payload Mismatch Profile",
      });
      await fixture.db.insert(automations).values({
        id: "atm_resolver_payload_mismatch",
        organizationId: session.organizationId,
        kind: AutomationKinds.WEBHOOK,
        name: "Only Security Label",
        enabled: true,
      });
      await fixture.db.insert(webhookAutomations).values({
        automationId: "atm_resolver_payload_mismatch",
        integrationConnectionId: connectionId,
        eventTypes: ["github.issues.labeled"],
        payloadFilter: {
          op: "eq",
          path: ["label", "name"],
          value: "security",
        },
        inputTemplate: "Handle issue labeled",
        conversationKeyTemplate: "github/issues/{{issue.id}}",
        idempotencyKeyTemplate: null,
      });
      await fixture.db.insert(automationTargets).values({
        id: "atg_resolver_payload_mismatch",
        automationId: "atm_resolver_payload_mismatch",
        sandboxProfileId: "sbp_resolver_payload_mismatch",
        sandboxProfileVersion: null,
      });

      const resolvedTargets = await resolveWebhookAutomationTargets(fixture.db, {
        organizationId: session.organizationId,
        integrationConnectionId: connectionId,
        eventType: "github.issues.labeled",
        payload: {
          label: {
            name: "bug",
          },
        },
      });

      expect(resolvedTargets).toEqual([]);
    },
    TestTimeoutMs,
  );

  it(
    "filters by organization, kind, and enabled flag, then fans out across targets",
    async ({ fixture }) => {
      const session = await fixture.authSession({
        email: "integration-resolve-webhook-automation-filtering@example.com",
      });
      const otherSession = await fixture.authSession({
        email: "integration-resolve-webhook-automation-filtering-other@example.com",
      });
      const targetKey = "github-cloud-resolver-filtering";
      const connectionId = "icn_resolver_filtering";

      await insertTargetAndConnection({
        fixture,
        targetKey,
        connectionId,
        organizationId: session.organizationId,
      });
      await insertSandboxProfile({
        fixture,
        profileId: "sbp_resolver_filtering_1",
        organizationId: session.organizationId,
        displayName: "Resolver Filtering Profile One",
      });
      await insertSandboxProfile({
        fixture,
        profileId: "sbp_resolver_filtering_2",
        organizationId: session.organizationId,
        displayName: "Resolver Filtering Profile Two",
      });
      await insertSandboxProfile({
        fixture,
        profileId: "sbp_resolver_filtering_other_org",
        organizationId: otherSession.organizationId,
        displayName: "Resolver Filtering Profile Other Org",
      });

      await fixture.db.insert(automations).values([
        {
          id: "atm_resolver_filtering_valid",
          organizationId: session.organizationId,
          kind: AutomationKinds.WEBHOOK,
          name: "Valid Automation",
          enabled: true,
        },
        {
          id: "atm_resolver_filtering_disabled",
          organizationId: session.organizationId,
          kind: AutomationKinds.WEBHOOK,
          name: "Disabled Automation",
          enabled: false,
        },
        {
          id: "atm_resolver_filtering_schedule",
          organizationId: session.organizationId,
          kind: AutomationKinds.SCHEDULE,
          name: "Schedule Automation",
          enabled: true,
        },
        {
          id: "atm_resolver_filtering_other_org",
          organizationId: otherSession.organizationId,
          kind: AutomationKinds.WEBHOOK,
          name: "Other Org Automation",
          enabled: true,
        },
      ]);

      await fixture.db.insert(webhookAutomations).values([
        {
          automationId: "atm_resolver_filtering_valid",
          integrationConnectionId: connectionId,
          eventTypes: null,
          payloadFilter: null,
          inputTemplate: "valid input",
          conversationKeyTemplate: "valid conversation",
          idempotencyKeyTemplate: null,
        },
        {
          automationId: "atm_resolver_filtering_disabled",
          integrationConnectionId: connectionId,
          eventTypes: null,
          payloadFilter: null,
          inputTemplate: "disabled input",
          conversationKeyTemplate: "disabled conversation",
          idempotencyKeyTemplate: null,
        },
        {
          automationId: "atm_resolver_filtering_schedule",
          integrationConnectionId: connectionId,
          eventTypes: null,
          payloadFilter: null,
          inputTemplate: "schedule input",
          conversationKeyTemplate: "schedule conversation",
          idempotencyKeyTemplate: null,
        },
        {
          automationId: "atm_resolver_filtering_other_org",
          integrationConnectionId: connectionId,
          eventTypes: null,
          payloadFilter: null,
          inputTemplate: "other org input",
          conversationKeyTemplate: "other org conversation",
          idempotencyKeyTemplate: null,
        },
      ]);

      await fixture.db.insert(automationTargets).values([
        {
          id: "atg_resolver_filtering_1",
          automationId: "atm_resolver_filtering_valid",
          sandboxProfileId: "sbp_resolver_filtering_1",
          sandboxProfileVersion: 1,
        },
        {
          id: "atg_resolver_filtering_2",
          automationId: "atm_resolver_filtering_valid",
          sandboxProfileId: "sbp_resolver_filtering_2",
          sandboxProfileVersion: 2,
        },
        {
          id: "atg_resolver_filtering_disabled",
          automationId: "atm_resolver_filtering_disabled",
          sandboxProfileId: "sbp_resolver_filtering_1",
          sandboxProfileVersion: 1,
        },
        {
          id: "atg_resolver_filtering_schedule",
          automationId: "atm_resolver_filtering_schedule",
          sandboxProfileId: "sbp_resolver_filtering_1",
          sandboxProfileVersion: 1,
        },
        {
          id: "atg_resolver_filtering_other_org",
          automationId: "atm_resolver_filtering_other_org",
          sandboxProfileId: "sbp_resolver_filtering_other_org",
          sandboxProfileVersion: 1,
        },
      ]);

      const resolvedTargets = await resolveWebhookAutomationTargets(fixture.db, {
        organizationId: session.organizationId,
        integrationConnectionId: connectionId,
        eventType: "github.anything",
        payload: {},
      });
      const sortedResolvedTargets = [...resolvedTargets].sort((left, right) =>
        left.automationTargetId.localeCompare(right.automationTargetId),
      );

      expect(sortedResolvedTargets).toEqual([
        {
          automationId: "atm_resolver_filtering_valid",
          automationName: "Valid Automation",
          automationTargetId: "atg_resolver_filtering_1",
          sandboxProfileId: "sbp_resolver_filtering_1",
          sandboxProfileVersion: 1,
          inputTemplate: "valid input",
          conversationKeyTemplate: "valid conversation",
          idempotencyKeyTemplate: null,
        },
        {
          automationId: "atm_resolver_filtering_valid",
          automationName: "Valid Automation",
          automationTargetId: "atg_resolver_filtering_2",
          sandboxProfileId: "sbp_resolver_filtering_2",
          sandboxProfileVersion: 2,
          inputTemplate: "valid input",
          conversationKeyTemplate: "valid conversation",
          idempotencyKeyTemplate: null,
        },
      ]);
    },
    TestTimeoutMs,
  );

  it(
    "fails fast when payload filter is invalid",
    async ({ fixture }) => {
      const session = await fixture.authSession({
        email: "integration-resolve-webhook-automation-invalid-filter@example.com",
      });
      const targetKey = "github-cloud-resolver-invalid-filter";
      const connectionId = "icn_resolver_invalid_filter";

      await insertTargetAndConnection({
        fixture,
        targetKey,
        connectionId,
        organizationId: session.organizationId,
      });
      await insertSandboxProfile({
        fixture,
        profileId: "sbp_resolver_invalid_filter",
        organizationId: session.organizationId,
        displayName: "Resolver Invalid Filter Profile",
      });
      await fixture.db.insert(automations).values({
        id: "atm_resolver_invalid_filter",
        organizationId: session.organizationId,
        kind: AutomationKinds.WEBHOOK,
        name: "Invalid Filter",
        enabled: true,
      });
      await fixture.db.insert(webhookAutomations).values({
        automationId: "atm_resolver_invalid_filter",
        integrationConnectionId: connectionId,
        eventTypes: null,
        payloadFilter: {
          op: "eq",
          path: [],
          value: "anything",
        },
        inputTemplate: "invalid filter input",
        conversationKeyTemplate: "invalid filter conversation",
        idempotencyKeyTemplate: null,
      });
      await fixture.db.insert(automationTargets).values({
        id: "atg_resolver_invalid_filter",
        automationId: "atm_resolver_invalid_filter",
        sandboxProfileId: "sbp_resolver_invalid_filter",
        sandboxProfileVersion: null,
      });

      await expect(
        resolveWebhookAutomationTargets(fixture.db, {
          organizationId: session.organizationId,
          integrationConnectionId: connectionId,
          eventType: "github.issue_comment.created",
          payload: {},
        }),
      ).rejects.toThrow("Webhook payload filter validation failed.");
    },
    TestTimeoutMs,
  );
});
