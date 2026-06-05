import type { Meta, StoryObj } from "@storybook/react-vite";
import { MemoryRouter } from "react-router";

import type { ChatEntry } from "../chat/chat-types.js";
import { buildSessionsShellSidebarItems } from "../navigation/sessions-shell-sidebar.js";
import { SessionsSidebarHeader } from "../navigation/sessions-sidebar-header.js";
import { SessionsSidebarNav } from "../navigation/sessions-sidebar-nav.js";
import { SessionComposerFixtureProps } from "../session-agents/codex/fixtures/session-fixtures.js";
import { AppShellView } from "../shell/app-shell-view.js";
import { createComposerDraft } from "./session-composer/session-composer-draft.js";
import { SessionConversationMainContent } from "./session-conversation-pane.js";
import { SessionDiffPanel } from "./session-diff-panel.js";
import { createStorySessionBottomPanel, StorySandboxInstanceId } from "./session-story-support.js";
import { SessionWorkbenchPageView } from "./session-workbench-page-view.js";
import { buildSandboxInstanceListItemFixture } from "./sessions-page.story-fixtures.js";

type ProductWorkbenchVariant = "diff" | "compact";

type ProductWorkbenchStoryArgs = {
  variant: ProductWorkbenchVariant;
};

const MarketingSemanticDisplayKeys = {
  exploring: {
    active: "exploring.active",
    completed: "exploring.done",
  },
  "making-edits": {
    active: "making-edits.active",
    completed: "making-edits.done",
  },
  "running-commands": {
    active: "running-commands.active",
    completed: "running-commands.done",
  },
} satisfies Record<
  "exploring" | "making-edits" | "running-commands",
  { active: string; completed: string }
>;

const MarketingHeroConversationEntries = [
  {
    id: "marketing-user-1",
    turnId: "marketing-turn-1",
    kind: "user-message",
    status: "completed",
    text: "Investigate why checkout retries sometimes double-charge customers, patch the bug, and open a PR with the evidence.",
  },
  {
    id: "marketing-assistant-1",
    turnId: "marketing-turn-1",
    kind: "assistant-message",
    phase: null,
    status: "completed",
    text: "I’ll trace the retry path, reproduce the duplicate ledger write, patch the idempotency check, and verify it with the billing integration test.",
  },
  {
    id: "marketing-plan-1",
    turnId: "marketing-turn-1",
    kind: "plan",
    explanation: "Tracking the checkout retry fix from investigation through PR.",
    steps: [
      {
        step: "Trace checkout retry handling",
        status: "completed",
      },
      {
        step: "Patch duplicate ledger write prevention",
        status: "completed",
      },
      {
        step: "Run billing integration coverage",
        status: "completed",
      },
      {
        step: "Open the pull request with evidence",
        status: "inProgress",
      },
    ],
    status: "streaming",
    text: null,
  },
  {
    id: "marketing-exploring-group-1",
    turnId: "marketing-turn-1",
    kind: "semantic-group",
    semanticKind: "exploring",
    status: "completed",
    displayKeys: MarketingSemanticDisplayKeys.exploring,
    counts: {
      reads: 3,
      searches: 1,
      lists: 1,
    },
    items: [
      {
        id: "marketing-exploring-1",
        sourceKind: "command-execution",
        label: "Search",
        detail: "checkout retry ledger writes",
        detailKind: "plain",
        command: 'rg -n "retry|idempotency|ledger" apps packages',
        output: [
          "apps/api/src/billing/checkout.ts:118:await recordLedgerEvent(...)",
          "apps/api/src/billing/retry-policy.ts:44:retryableCheckoutStatuses",
          "apps/api/integration/billing-checkout.integration.test.ts:72:retries preserve one ledger event",
        ].join("\n"),
        status: "completed",
      },
      {
        id: "marketing-exploring-2",
        sourceKind: "command-execution",
        label: "Read",
        detail: "apps/api/src/billing/checkout.ts",
        detailKind: "code",
        sourcePath: "apps/api/src/billing/checkout.ts",
        command: "sed -n '90,150p' apps/api/src/billing/checkout.ts",
        output: [
          "const existingEvent = await findLedgerEventForAttempt(...);",
          "if (existingEvent !== null) {",
          "  return existingEvent;",
          "}",
        ].join("\n"),
        status: "completed",
      },
    ],
  },
  {
    id: "marketing-edits-group-1",
    turnId: "marketing-turn-1",
    kind: "semantic-group",
    semanticKind: "making-edits",
    status: "completed",
    displayKeys: MarketingSemanticDisplayKeys["making-edits"],
    counts: null,
    items: [
      {
        id: "marketing-edit-1",
        sourceKind: "file-change",
        label: "Updated",
        detail: "apps/api/src/billing/checkout.ts",
        detailKind: "code",
        command: null,
        output: [
          "@@ -116,6 +116,11 @@",
          "+const existingLedgerEvent = await findLedgerEventForAttempt({",
          "+  checkoutAttemptId,",
          "+  customerId,",
          "+});",
          "+if (existingLedgerEvent !== null) return existingLedgerEvent;",
        ].join("\n"),
        status: "completed",
      },
      {
        id: "marketing-edit-2",
        sourceKind: "file-change",
        label: "Added",
        detail: "apps/api/integration/billing-checkout.integration.test.ts",
        detailKind: "code",
        command: null,
        output: [
          "@@ -84,6 +84,16 @@",
          "+test('checkout retry keeps one ledger event', async ({ env }) => {",
          "+  const response = await retryCheckout(env, checkoutAttemptId);",
          "+  expect(response.status).toBe(200);",
          "+});",
        ].join("\n"),
        status: "completed",
      },
    ],
  },
  {
    id: "marketing-commands-group-1",
    turnId: "marketing-turn-1",
    kind: "semantic-group",
    semanticKind: "running-commands",
    status: "completed",
    displayKeys: MarketingSemanticDisplayKeys["running-commands"],
    counts: null,
    items: [
      {
        id: "marketing-command-1",
        sourceKind: "command-execution",
        label: "Command",
        detail:
          "pnpm test:integration -- --project api apps/api/integration/billing-checkout.integration.test.ts",
        detailKind: "code",
        command:
          "pnpm test:integration -- --project api apps/api/integration/billing-checkout.integration.test.ts",
        output: [
          "✓ billing checkout retries do not duplicate ledger events 412ms",
          "✓ invoice balance remains stable after retry replay 281ms",
          "",
          "Test Files  1 passed (1)",
          "Tests       2 passed (2)",
        ].join("\n"),
        status: "completed",
      },
    ],
  },
  {
    id: "marketing-assistant-2",
    turnId: "marketing-turn-1",
    kind: "assistant-message",
    phase: null,
    status: "completed",
    text: [
      "Opened PR #1284 with the duplicate-charge fix.",
      "",
      "- added an idempotency guard before ledger writes",
      "- covered retry replay through the real billing integration path",
      "- included the failing scenario, patch summary, and test evidence in the PR",
    ].join("\n"),
  },
] satisfies readonly ChatEntry[];

const MarketingHeroPatch = [
  "diff --git a/apps/api/src/billing/checkout.ts b/apps/api/src/billing/checkout.ts",
  "index 3a3d80f..9c81b22 100644",
  "--- a/apps/api/src/billing/checkout.ts",
  "+++ b/apps/api/src/billing/checkout.ts",
  "@@ -112,6 +112,15 @@ export async function completeCheckoutAttempt(input: CheckoutAttemptInput) {",
  "   const checkoutAttemptId = input.checkoutAttemptId;",
  "   const customerId = input.customerId;",
  " ",
  "+  const existingLedgerEvent = await findLedgerEventForAttempt({",
  "+    checkoutAttemptId,",
  "+    customerId,",
  "+  });",
  "+  if (existingLedgerEvent !== null) {",
  "+    return existingLedgerEvent;",
  "+  }",
  "+",
  "   return recordLedgerEvent({",
  "     checkoutAttemptId,",
  "     customerId,",
  "diff --git a/apps/api/integration/billing-checkout.integration.test.ts b/apps/api/integration/billing-checkout.integration.test.ts",
  "index 1b82fea..3d82c80 100644",
  "--- a/apps/api/integration/billing-checkout.integration.test.ts",
  "+++ b/apps/api/integration/billing-checkout.integration.test.ts",
  "@@ -72,6 +72,19 @@ describe.concurrent('billing checkout', () => {",
  "     expect(balance.availableCents).toBe(2500);",
  "   });",
  " ",
  "+  test('checkout retry keeps one ledger event', async ({ env }) => {",
  "+    const checkoutAttempt = await createCheckoutAttempt(env);",
  "+",
  "+    await completeCheckoutAttempt(env, checkoutAttempt.id);",
  "+    await completeCheckoutAttempt(env, checkoutAttempt.id);",
  "+",
  "+    const ledgerEvents = await listLedgerEvents(env, checkoutAttempt.id);",
  "+    expect(ledgerEvents).toHaveLength(1);",
  "+  });",
  "+",
  " });",
].join("\n");

const MarketingHeroSessions = [
  buildSandboxInstanceListItemFixture({
    id: "sbi_checkout_retry",
    title: "Fix duplicate checkout charges on retry",
    sandboxProfileDisplayName: "Agent Engineer",
    status: "running",
    createdAt: "2026-05-05T01:05:00.000Z",
    updatedAt: "2026-05-05T01:23:00.000Z",
  }),
  buildSandboxInstanceListItemFixture({
    id: "sbi_pr_review",
    title: "Review auth token rotation PR",
    sandboxProfileDisplayName: "Security Reviewer",
    status: "running",
    createdAt: "2026-05-05T00:12:00.000Z",
    updatedAt: "2026-05-05T01:10:00.000Z",
  }),
  buildSandboxInstanceListItemFixture({
    id: "sbi_release_notes",
    title: "Draft release notes for webhook triggers",
    sandboxProfileDisplayName: "Docs Maintainer",
    status: "stopped",
    createdAt: "2026-05-04T12:30:00.000Z",
    updatedAt: "2026-05-04T14:45:00.000Z",
  }),
  buildSandboxInstanceListItemFixture({
    id: "sbi_invoice_export",
    title: "Reconcile April invoice export",
    sandboxProfileDisplayName: "Agent Engineer",
    status: "stopped",
    createdAt: "2026-05-04T09:00:00.000Z",
    updatedAt: "2026-05-04T10:30:00.000Z",
  }),
  buildSandboxInstanceListItemFixture({
    id: "sbi_gateway_latency",
    title: "Investigate gateway latency spike",
    sandboxProfileDisplayName: "Security Reviewer",
    status: "running",
    createdAt: "2026-05-04T07:10:00.000Z",
    updatedAt: "2026-05-04T08:18:00.000Z",
  }),
  buildSandboxInstanceListItemFixture({
    id: "sbi_dependency_updates",
    title: "Review dependency updates for the web app",
    sandboxProfileDisplayName: "Security Reviewer",
    status: "stopped",
    createdAt: "2026-05-03T15:15:00.000Z",
    updatedAt: "2026-05-03T16:20:00.000Z",
  }),
  buildSandboxInstanceListItemFixture({
    id: "sbi_slack_workflow",
    title: "Add Slack workflow approval copy",
    sandboxProfileDisplayName: "Agent Engineer",
    status: "stopped",
    createdAt: "2026-05-03T10:00:00.000Z",
    updatedAt: "2026-05-03T11:35:00.000Z",
  }),
  buildSandboxInstanceListItemFixture({
    id: "sbi_runbook_refresh",
    title: "Refresh incident response runbook",
    sandboxProfileDisplayName: "Docs Maintainer",
    status: "stopped",
    createdAt: "2026-05-02T13:40:00.000Z",
    updatedAt: "2026-05-02T15:05:00.000Z",
  }),
  buildSandboxInstanceListItemFixture({
    id: "sbi_webhook_tests",
    title: "Harden webhook retry tests",
    sandboxProfileDisplayName: "Agent Engineer",
    status: "stopped",
    createdAt: "2026-05-02T07:20:00.000Z",
    updatedAt: "2026-05-02T09:50:00.000Z",
  }),
  buildSandboxInstanceListItemFixture({
    id: "sbi_cli_docs",
    title: "Document CLI setup for new contributors",
    sandboxProfileDisplayName: "Docs Maintainer",
    status: "stopped",
    createdAt: "2026-05-01T16:00:00.000Z",
    updatedAt: "2026-05-01T17:15:00.000Z",
  }),
  buildSandboxInstanceListItemFixture({
    id: "sbi_metrics_dashboard",
    title: "Clean up dashboard metrics labels",
    sandboxProfileDisplayName: "Agent Engineer",
    status: "stopped",
    createdAt: "2026-05-01T09:30:00.000Z",
    updatedAt: "2026-05-01T12:00:00.000Z",
  }),
  buildSandboxInstanceListItemFixture({
    id: "sbi_billing_copy",
    title: "Tighten billing settings copy",
    sandboxProfileDisplayName: "Docs Maintainer",
    status: "stopped",
    createdAt: "2026-04-30T14:00:00.000Z",
    updatedAt: "2026-04-30T15:25:00.000Z",
  }),
  buildSandboxInstanceListItemFixture({
    id: "sbi_release_checklist",
    title: "Update release checklist trigger",
    sandboxProfileDisplayName: "Docs Maintainer",
    status: "stopped",
    createdAt: "2026-04-30T08:30:00.000Z",
    updatedAt: "2026-04-30T10:45:00.000Z",
  }),
  buildSandboxInstanceListItemFixture({
    id: "sbi_signup_trace",
    title: "Trace signup conversion drop",
    sandboxProfileDisplayName: "Security Reviewer",
    status: "stopped",
    createdAt: "2026-04-29T12:00:00.000Z",
    updatedAt: "2026-04-29T13:40:00.000Z",
  }),
  buildSandboxInstanceListItemFixture({
    id: "sbi_storage_audit",
    title: "Audit sandbox teardown logs",
    sandboxProfileDisplayName: "Security Reviewer",
    status: "stopped",
    createdAt: "2026-04-28T11:15:00.000Z",
    updatedAt: "2026-04-28T12:30:00.000Z",
  }),
];

function noop(): void {
  return;
}

function MarketingHeroConversation(): React.JSX.Element {
  return (
    <SessionConversationMainContent
      activeTurnId="marketing-turn-1"
      chatEntries={MarketingHeroConversationEntries}
      isRespondingToServerRequest={false}
      isTurnInProgress
      onRespondToServerRequest={noop}
      pendingTurnId={null}
      serverRequestPanelEntries={[]}
    />
  );
}

function MarketingHeroDiffPanel(): React.JSX.Element {
  return (
    <SessionDiffPanel
      patch={MarketingHeroPatch}
      repositoryPath="/workspace/acme-store"
      summaryLabel="+24 -0"
      title="PR #1284"
    />
  );
}

function MarketingHeroSidebar(): React.JSX.Element {
  return (
    <div className="animate-in fade-in-0 duration-200">
      <SessionsSidebarHeader checked onCheckedChange={noop} />
      <SessionsSidebarNav
        items={buildSessionsShellSidebarItems(MarketingHeroSessions, {
          nowEpochMs: Date.parse("2026-05-05T01:30:00.000Z"),
        })}
      />
    </div>
  );
}

function MarketingHeroShell(input: { children: React.ReactNode }): React.JSX.Element {
  return (
    <MemoryRouter initialEntries={["/sessions/sbi_checkout_retry"]}>
      <AppShellView
        contentInsetOwner="child"
        mainContent={input.children}
        renderSidebarTrigger={false}
        sidebarContent={<MarketingHeroSidebar />}
        sidebarFooterContent={null}
        sidebarHeaderContent={null}
        topLoadingBar={null}
        viewportMode="workspace"
      />
    </MemoryRouter>
  );
}

function MarketingProductWorkbenchStory(input: ProductWorkbenchStoryArgs): React.JSX.Element {
  const showDiff = input.variant === "diff";

  return (
    <MarketingHeroShell>
      <SessionWorkbenchPageView
        alert={null}
        bottomPanel={null}
        isBottomPanelVisible={false}
        isSecondaryPanelVisible={showDiff}
        mainContent={<MarketingHeroConversation />}
        primaryBottomPanel={createStorySessionBottomPanel({
          activeTurnId: "marketing-turn-1",
          chatEntries: MarketingHeroConversationEntries,
          composerViewModel: {
            ...SessionComposerFixtureProps,
            composerDraft: createComposerDraft(
              "Apply the reviewer note and rerun the billing test.",
            ),
            gitBranchLabel: "fix/checkout-retry-ledger",
            pullRequest: {
              isDraft: false,
              number: 1284,
              state: "OPEN",
              title: "Prevent duplicate checkout ledger events",
              url: "https://github.com/acme/storefront/pull/1284",
            },
          },
          isTurnInProgress: true,
          showWorkingIndicator: false,
        })}
        sandboxInstanceId={StorySandboxInstanceId}
        secondaryPanel={showDiff ? <MarketingHeroDiffPanel /> : null}
      />
    </MarketingHeroShell>
  );
}

/**
 * Marketing screenshot source for the mistle.dev hero. Capture these stories at a
 * fixed viewport when refreshing website product screenshots; the fixture copy is
 * intentionally dummy product data, while the shell, chat, diff, ports, and composer
 * all render through real dashboard components.
 */
const meta = {
  title: "Product Screens/Product Workbench/Hero",
  component: MarketingProductWorkbenchStory,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
  },
  args: {
    variant: "diff",
  },
  render: function RenderStory(args): React.JSX.Element {
    return <MarketingProductWorkbenchStory {...args} />;
  },
} satisfies Meta<typeof MarketingProductWorkbenchStory>;

export default meta;

type Story = StoryObj<typeof meta>;

export const HeroProductWorkbench: Story = {};

export const HeroProductWorkbenchCompact: Story = {
  args: {
    variant: "compact",
  },
};
