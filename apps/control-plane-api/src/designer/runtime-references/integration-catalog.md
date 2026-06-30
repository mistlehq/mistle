<!-- Generated from the Mistle integration registry. Do not edit by hand. Run pnpm --filter @mistle/control-plane-api designer:integration-catalog:generate. -->

# Designer Integration Catalog

Static integration metadata for Mistle Designer runtime lookup. Use this file to resolve user-facing provider names to provider family ids, integration target keys, setup method ids, and supported resource kinds before broad integration MCP discovery.

## AgentMail

Provider family ID: `agentmail`
Integration target key: `agentmail-mcp`
Variant ID: `agentmail-mcp`
Description: Enable AgentMail hosted MCP access for inboxes, threads, messages, and drafts.

Setup methods:

- `oauth2-authorization-code` (redirect): AgentMail OAuth

Binding tools:

- `agentmail-mcp`: AgentMail MCP (default)

## Anthropic

Provider family ID: `anthropic`
Integration target key: `anthropic-default`
Variant ID: `anthropic-default`
Description: Enable Anthropic model access with API key authentication.

Setup methods:

- `api-key` (form): API key

## Autumn

Provider family ID: `autumn`
Integration target key: `autumn-mcp`
Variant ID: `autumn-mcp`
Description: Enable Autumn hosted MCP access for billing, customer, plan, balance, and request-log workflows.

Setup methods:

- `api-key` (form): Secret key

## AWS

Provider family ID: `aws`
Integration target key: `aws-cli-default`
Variant ID: `aws-cli-default`
Description: Enable scoped AWS access for selected sandbox tools and MCP servers.

Setup methods:

- `aws-assume-role` (form): Access key + AssumeRole

Binding tools:

- `aws-cli`: AWS CLI (default)
- `aws-cloudwatch-mcp`: CloudWatch MCP

## BugSnag

Provider family ID: `bugsnag`
Integration target key: `bugsnag-mcp`
Variant ID: `bugsnag-mcp`
Description: Enable SmartBear hosted BugSnag MCP access for errors and performance data.

Setup methods:

- `oauth2-authorization-code` (redirect): BugSnag OAuth

Binding tools:

- `bugsnag-mcp`: BugSnag MCP (default)

## Cloudflare

Provider family ID: `cloudflare`
Integration target key: `cloudflare-mcp`
Variant ID: `cloudflare-mcp`
Description: Enable Cloudflare API MCP Code Mode access.

Setup methods:

- `api-key` (form): API token

## Datadog

Provider family ID: `datadog`
Integration target key: `datadog-default`
Variant ID: `datadog-default`
Description: Enable Datadog hosted MCP access for observability search and tooling.

Setup methods:

- `api-key` (form): API key + application key

Binding tools:

- `datadog-mcp`: Datadog MCP (default)

## DataForSEO

Provider family ID: `dataforseo`
Integration target key: `dataforseo-mcp`
Variant ID: `dataforseo-mcp`
Description: Enable DataForSEO hosted MCP access for SEO and marketing data APIs.

Setup methods:

- `oauth2-authorization-code` (redirect): DataForSEO OAuth

Binding tools:

- `dataforseo-mcp`: DataForSEO MCP (default)

## DeepSeek

Provider family ID: `deepseek`
Integration target key: `deepseek-default`
Variant ID: `deepseek-default`
Description: Enable DeepSeek model access with API key authentication.

Setup methods:

- `api-key` (form): API key

## Discord

Provider family ID: `discord`
Integration target key: `discord-default`
Variant ID: `discord-default`
Description: Enable access to Discord REST API operations, local Discord MCP tools, and signed Discord HTTP callbacks.

Setup methods:

- `discord-bot` (form): Discord bot

Resource kinds:

- `guild`: guilds (multi)
- `channel`: channels (multi)

Binding tools:

- `discord-cli`: Discord CLI
- `discord-mcp`: Discord MCP

Trigger events:

- `discord:application_authorized`: Application authorized
- `discord:application_deauthorized`: Application deauthorized
- `discord:entitlement_create`: Entitlement created
- `discord:entitlement_update`: Entitlement updated
- `discord:entitlement_delete`: Entitlement deleted
- `discord:message_create`: Message created
- `discord:message_update`: Message updated
- `discord:message_delete`: Message deleted
- `discord:message_reaction_add`: Reaction added
- `discord:message_reaction_remove`: Reaction removed

## E2B

Provider family ID: `e2b`
Integration target key: `e2b-default`
Variant ID: `e2b-default`
Description: Run sandboxes on E2B with your organization's API keys.

Setup methods:

- `api-key` (form): API key

Binding tools:

- `e2b-cli`: E2B CLI

## Expo

Provider family ID: `expo`
Integration target key: `expo-mcp`
Variant ID: `expo-mcp`
Description: Enable Expo hosted MCP access for Expo docs, EAS builds, workflows, and TestFlight data.

Setup methods:

- `oauth2-authorization-code` (redirect): Expo MCP OAuth

## Fireworks AI

Provider family ID: `fireworks`
Integration target key: `fireworks-default`
Variant ID: `fireworks-default`
Description: Enable Fireworks AI model access with API key authentication.

Setup methods:

- `api-key` (form): API key

## GitHub

Provider family ID: `github`
Integration target key: `github-cloud`
Variant ID: `github-cloud`
Description: Enable webhooks, repository access, and optional GitHub CLI in sandbox.

Setup methods:

- `api-key` (form): API key
- `github-app-installation` (form): GitHub App installation

Resource kinds:

- `repository`: repositories (multi)
- `branch`: branches (multi)
- `user`: users (multi)
- `org`: organizations (multi)
- `team`: teams (multi)
- `bot`: GitHub App bots (multi)

Binding tools:

- `github-cli`: GitHub CLI (default)

Trigger events:

- `github.issues.opened`: Issue opened
- `github.issues.closed`: Issue closed
- `github.issues.reopened`: Issue reopened
- `github.issue_comment.created`: Issue comment created
- `github.pull_request.opened`: Pull request opened
- `github.pull_request.closed`: Pull request closed
- `github.pull_request.reopened`: Pull request reopened
- `github.pull_request.synchronize`: Pull request updated
- `github.pull_request.ready_for_review`: Pull request ready for review
- `github.pull_request.review_requested`: Pull request review requested
- `github.pull_request.review_request_removed`: Pull request review request removed
- `github.pull_request_review.submitted`: Pull request review submitted
- `github.pull_request_review_comment.created`: Pull request review comment created
- `github.push.pushed`: New push to branch
- `github.check_suite.completed`: CI completed

## GitHub Enterprise Server

Provider family ID: `github`
Integration target key: `github-enterprise-server`
Variant ID: `github-enterprise-server`
Description: Enable webhooks, repository access, and optional GitHub CLI in sandbox.

Setup methods:

- `api-key` (form): API key
- `github-app-installation` (form): GitHub App installation

Resource kinds:

- `repository`: repositories (multi)
- `branch`: branches (multi)
- `user`: users (multi)
- `org`: organizations (multi)
- `team`: teams (multi)
- `bot`: GitHub App bots (multi)

Binding tools:

- `github-cli`: GitHub CLI (default)

Trigger events:

- `github.issues.opened`: Issue opened
- `github.issues.closed`: Issue closed
- `github.issues.reopened`: Issue reopened
- `github.issue_comment.created`: Issue comment created
- `github.pull_request.opened`: Pull request opened
- `github.pull_request.closed`: Pull request closed
- `github.pull_request.reopened`: Pull request reopened
- `github.pull_request.synchronize`: Pull request updated
- `github.pull_request.ready_for_review`: Pull request ready for review
- `github.pull_request.review_requested`: Pull request review requested
- `github.pull_request.review_request_removed`: Pull request review request removed
- `github.pull_request_review.submitted`: Pull request review submitted
- `github.pull_request_review_comment.created`: Pull request review comment created
- `github.push.pushed`: New push to branch
- `github.check_suite.completed`: CI completed

## Google Ads

Provider family ID: `googleads`
Integration target key: `googleads-default`
Variant ID: `googleads-default`
Description: Enable Google Ads API access in sandbox.

Setup methods:

- `oauth2-authorization-code` (redirect): Google OAuth

Binding tools:

- `googleads-cli`: Google Ads CLI
- `googleads-mcp`: Google Ads MCP (default)

## Google Analytics

Provider family ID: `google-analytics`
Integration target key: `google-analytics-mcp`
Variant ID: `google-analytics-mcp`
Description: Enable Google Analytics 4 reporting and metadata access in sandbox.

Setup methods:

- `oauth2-authorization-code` (redirect): Google OAuth

Binding tools:

- `google-analytics-cli`: Google Analytics CLI
- `google-analytics-mcp`: Google Analytics MCP (default)

## Google Business Profile

Provider family ID: `google-business-profile`
Integration target key: `google-business-profile-mcp`
Variant ID: `google-business-profile-mcp`
Description: Enable Google Business Profile management and performance access in sandbox.

Setup methods:

- `oauth2-authorization-code` (redirect): Google OAuth

Binding tools:

- `google-business-profile-cli`: Google Business Profile CLI
- `google-business-profile-mcp`: Google Business Profile MCP (default)

## Google Cloud

Provider family ID: `gcp`
Integration target key: `gcp-mcp`
Variant ID: `gcp-mcp`
Description: Enable Google-hosted MCP access for Google Cloud services.

Setup methods:

- `oauth2-authorization-code` (redirect): Google OAuth

## Google Search Console

Provider family ID: `google-search-console`
Integration target key: `google-search-console-mcp`
Variant ID: `google-search-console-mcp`
Description: Enable Google Search Console search performance and indexing access in sandbox.

Setup methods:

- `oauth2-authorization-code` (redirect): Google OAuth

Binding tools:

- `google-search-console-cli`: Google Search Console CLI
- `google-search-console-mcp`: Google Search Console MCP (default)

## Google Workspace

Provider family ID: `google-workspace`
Integration target key: `google-workspace-mcp`
Variant ID: `google-workspace-mcp`
Description: Enable Google Workspace access for Gmail, Drive, Sheets, Docs, Slides, Calendar, Chat, and People.

Setup methods:

- `oauth2-authorization-code` (redirect): Google OAuth
- `google-workspace-service-account` (form): Service account

## Inception Labs

Provider family ID: `inception`
Integration target key: `inception-default`
Variant ID: `inception-default`
Description: Enable Inception Labs model access with API key authentication.

Setup methods:

- `api-key` (form): API key

## Jira

Provider family ID: `jira`
Integration target key: `jira-default`
Variant ID: `jira-default`
Description: Enable Jira issue access, trigger, and optional Jira CLI in sandbox.

Setup methods:

- `jira-personal-api-token` (form): Personal API token
- `jira-service-account-api-token` (form): Service account API token
- `jira-service-account-oauth-client-credentials` (form): Service account OAuth client credentials

Binding tools:

- `jira-cli`: Jira CLI (default)
- `jira-mcp`: Jira MCP

Trigger events:

- `jira:issue_created`: Issue created
- `jira:issue_updated`: Issue updated
- `comment_created`: Comment created
- `comment_updated`: Comment updated

## Kimi

Provider family ID: `kimi`
Integration target key: `kimi-default`
Variant ID: `kimi-default`
Description: Enable Kimi model access with API key authentication.

Setup methods:

- `api-key` (form): API key

## Klaviyo

Provider family ID: `klaviyo`
Integration target key: `klaviyo-mcp`
Variant ID: `klaviyo-mcp`
Description: Enable Klaviyo hosted MCP access for campaigns, flows, profiles, and reporting.

Setup methods:

- `oauth2-authorization-code` (redirect): Klaviyo OAuth

Binding tools:

- `klaviyo-mcp`: Klaviyo MCP (default)

## Linear

Provider family ID: `linear`
Integration target key: `linear-default`
Variant ID: `linear-default`
Description: Enable access to Linear issues, projects, and workflows from agents.

Setup methods:

- `api-key` (form): API key
- `linear-oauth-app` (form): Linear OAuth app

Binding tools:

- `linear-mcp`: Linear MCP

Trigger events:

- `linear.issue.created`: Issue created
- `linear.issue.updated`: Issue updated
- `linear.issue.removed`: Issue removed
- `linear.comment.created`: Comment created
- `linear.comment.updated`: Comment updated
- `linear.comment.removed`: Comment removed
- `linear.issue_label.created`: Issue label created
- `linear.issue_label.updated`: Issue label updated
- `linear.issue_label.removed`: Issue label removed
- `linear.project.created`: Project created
- `linear.project.updated`: Project updated
- `linear.project.removed`: Project removed
- `linear.cycle.created`: Cycle created
- `linear.cycle.updated`: Cycle updated
- `linear.cycle.removed`: Cycle removed
- `linear.reaction.created`: Reaction created
- `linear.reaction.updated`: Reaction updated
- `linear.reaction.removed`: Reaction removed

## Meta Ads

Provider family ID: `metaads`
Integration target key: `metaads-default`
Variant ID: `metaads-default`
Description: Enable Meta Marketing API access in sandbox.

Setup methods:

- `api-key` (form): Access token

Binding tools:

- `metaads-cli`: Meta Ads CLI
- `metaads-mcp`: Meta Ads MCP (default)

## MiniMax

Provider family ID: `minimax`
Integration target key: `minimax-default`
Variant ID: `minimax-default`
Description: Enable MiniMax model access with API key authentication.

Setup methods:

- `api-key` (form): API key

## Modal

Provider family ID: `modal`
Integration target key: `modal-default`
Variant ID: `modal-default`
Description: Run sandboxes on Modal VM Sandboxes with your organization's token.

Setup methods:

- `api-key` (form): Token

## Notion

Provider family ID: `notion`
Integration target key: `notion-mcp`
Variant ID: `notion-mcp`
Description: Enable Notion hosted MCP access for workspace search, pages, databases, and comments.

Setup methods:

- `oauth2-authorization-code` (redirect): Notion MCP OAuth

Binding tools:

- `notion-mcp`: Notion MCP (default)

## OpenAI

Provider family ID: `openai`
Integration target key: `openai-default`
Variant ID: `openai-default`
Description: Enable OpenAI model access with API key or ChatGPT subscription authentication.

Setup methods:

- `api-key` (form): API key
- `chatgpt-device-code` (device-authorization): ChatGPT subscription

## OpenCode Go

Provider family ID: `opencode`
Integration target key: `opencode-go`
Variant ID: `opencode-go`
Description: Enable OpenCode Go model access with API key authentication.

Setup methods:

- `api-key` (form): API key

## OpenComputer

Provider family ID: `opencomputer`
Integration target key: `opencomputer-default`
Variant ID: `opencomputer-default`
Description: Run sandboxes on OpenComputer with your organization's API key.

Setup methods:

- `api-key` (form): API key

Binding tools:

- `opencomputer-cli`: OpenComputer CLI

## OpenRouter

Provider family ID: `openrouter`
Integration target key: `openrouter-default`
Variant ID: `openrouter-default`
Description: Enable OpenRouter model access with API key authentication.

Setup methods:

- `api-key` (form): API key

## PlanetScale

Provider family ID: `planetscale`
Integration target key: `planetscale-mcp`
Variant ID: `planetscale-mcp`
Description: Enable PlanetScale hosted MCP access for databases, schema, and insights.

Setup methods:

- `oauth2-authorization-code` (redirect): PlanetScale OAuth

Binding tools:

- `planetscale-mcp`: PlanetScale MCP
- `planetscale-insights-mcp`: PlanetScale Insights MCP

## PostHog

Provider family ID: `posthog`
Integration target key: `posthog-mcp`
Variant ID: `posthog-mcp`
Description: Enable PostHog hosted MCP access for analytics, feature flags, and errors.

Setup methods:

- `oauth2-authorization-code` (redirect): PostHog OAuth

Binding tools:

- `posthog-mcp`: PostHog MCP (default)

## Railway

Provider family ID: `railway`
Integration target key: `railway-mcp`
Variant ID: `railway-mcp`
Description: Enable Railway hosted MCP access for projects, services, deployments, and logs.

Setup methods:

- `oauth2-authorization-code` (redirect): Railway OAuth

Binding tools:

- `railway-mcp`: Railway MCP (default)

## Render

Provider family ID: `render`
Integration target key: `render-mcp`
Variant ID: `render-mcp`
Description: Enable Render hosted MCP access for services, databases, logs, and metrics.

Setup methods:

- `api-key` (form): API key

Binding tools:

- `render-mcp`: Render MCP (default)

## Resend

Provider family ID: `resend`
Integration target key: `resend-mcp`
Variant ID: `resend-mcp`
Description: Enable Resend MCP access for email, contacts, broadcasts, domains, and webhooks.

Setup methods:

- `api-key` (form): API key

Binding tools:

- `resend-mcp`: Resend MCP (default)

## Sentry

Provider family ID: `sentry`
Integration target key: `sentry-default`
Variant ID: `sentry-default`
Description: Enable Sentry issue webhooks and hosted MCP access.

Setup methods:

- `oauth2-authorization-code` (redirect): Sentry MCP OAuth
- `sentry-webhook-signing-secret` (form): Sentry webhooks

Binding tools:

- `sentry-mcp`: Sentry MCP (default)

Trigger events:

- `sentry.issue.created`: Issue created
- `sentry.issue.resolved`: Issue resolved
- `sentry.issue.assigned`: Issue assigned
- `sentry.issue.archived`: Issue archived
- `sentry.issue.unresolved`: Issue unresolved

## Shopify

Provider family ID: `shopify`
Integration target key: `shopify-default`
Variant ID: `shopify-default`
Description: Enable Shopify Admin API access in sandbox.

Setup methods:

- `oauth2-authorization-code` (redirect): Custom distribution OAuth
- `shopify-custom-app-client-credentials` (form): Custom app client credentials

Binding tools:

- `shopify-cli`: Shopify CLI
- `shopify-mcp`: Shopify MCP (default)

## SigNoz

Provider family ID: `signoz`
Integration target key: `signoz-mcp`
Variant ID: `signoz-mcp`
Description: Enable SigNoz hosted MCP access for observability tools and search.

Setup methods:

- `oauth2-authorization-code` (redirect): SigNoz OAuth

Binding tools:

- `signoz-mcp`: SigNoz MCP

## Slack

Provider family ID: `slack`
Integration target key: `slack-default`
Variant ID: `slack-default`
Description: Enable access to Slack Web API endpoints and Slack Events API callbacks.

Setup methods:

- `slack-bot-token` (form): Slack app

Resource kinds:

- `workspace`: workspaces (single)
- `channel`: channels (multi)
- `user`: users (multi)
- `user_group`: user groups (multi)

Binding tools:

- `slack-cli`: Slack CLI (default)
- `slack-mcp`: Slack MCP

Trigger events:

- `slack:message`: Message
- `slack:app_mention`: App mention
- `slack:reaction_added`: Reaction added
- `slack:reaction_removed`: Reaction removed

## Stripe

Provider family ID: `stripe`
Integration target key: `stripe-mcp`
Variant ID: `stripe-mcp`
Description: Enable Stripe hosted MCP access for customers, invoices, products, payments, and documentation.

Setup methods:

- `oauth2-authorization-code` (redirect): Stripe MCP OAuth

Binding tools:

- `stripe-mcp`: Stripe MCP (default)

## Supabase

Provider family ID: `supabase`
Integration target key: `supabase-mcp`
Variant ID: `supabase-mcp`
Description: Enable Supabase hosted MCP access for projects, databases, Auth, and Edge Functions.

Setup methods:

- `oauth2-authorization-code` (redirect): Supabase MCP OAuth

Binding tools:

- `supabase-mcp`: Supabase MCP (default)

## Tensorlake

Provider family ID: `tensorlake`
Integration target key: `tensorlake-default`
Variant ID: `tensorlake-default`
Description: Run sandboxes on Tensorlake with your organization's API keys.

Setup methods:

- `api-key` (form): API key

Binding tools:

- `tensorlake-cli`: Tensorlake CLI

## WasenderAPI

Provider family ID: `wasenderapi`
Integration target key: `wasenderapi-mcp`
Variant ID: `wasenderapi-mcp`
Description: Enable WasenderAPI hosted MCP access for WhatsApp sessions.

Setup methods:

- `api-key` (form): Personal access token

Binding tools:

- `wasenderapi-mcp`: WasenderAPI MCP (default)

Trigger events:

- `wasenderapi.messages.received`: Message received
- `wasenderapi.messages.upsert`: Message upsert
- `wasenderapi.messages-personal.received`: Personal message received
- `wasenderapi.messages-group.received`: Group message received
- `wasenderapi.messages-newsletter.received`: Newsletter message received
- `wasenderapi.message.sent`: Message sent
- `wasenderapi.messages.update`: Message status update
- `wasenderapi.messages.delete`: Message deleted
- `wasenderapi.message-receipt.update`: Message receipt update
- `wasenderapi.messages.reaction`: Message reaction
- `wasenderapi.call`: Call received
- `wasenderapi.session.status`: Session status
- `wasenderapi.qrcode.updated`: QR code updated
- `wasenderapi.chats.upsert`: Chat upsert
- `wasenderapi.chats.update`: Chat update
- `wasenderapi.chats.delete`: Chat deleted
- `wasenderapi.groups.upsert`: Group upsert
- `wasenderapi.groups.update`: Group update
- `wasenderapi.group-participants.update`: Group participants update
- `wasenderapi.contacts.upsert`: Contact upsert
- `wasenderapi.contacts.update`: Contact update
- `wasenderapi.poll.results`: Poll results

## Whapi

Provider family ID: `whapi`
Integration target key: `whapi-mcp`
Variant ID: `whapi-mcp`
Description: Enable Whapi MCP access and webhook triggers for WhatsApp channels.

Setup methods:

- `api-key` (form): API token

Binding tools:

- `whapi-mcp`: Whapi MCP (default)

Trigger events:

- `whapi.messages.post`: Message created
- `whapi.messages.put`: Message updated
- `whapi.messages.delete`: Message deleted
- `whapi.messages.patch`: Message patched
- `whapi.statuses.post`: Status created
- `whapi.statuses.put`: Status updated
- `whapi.chats.post`: Chat created
- `whapi.chats.put`: Chat updated
- `whapi.chats.delete`: Chat deleted
- `whapi.chats.patch`: Chat patched
- `whapi.contacts.post`: Contact created
- `whapi.contacts.patch`: Contact patched
- `whapi.groups.post`: Group created
- `whapi.groups.put`: Group updated
- `whapi.groups.patch`: Group patched
- `whapi.presences.post`: Presence changed
- `whapi.channel.post`: Channel status changed
- `whapi.channel.patch`: Channel patched
- `whapi.users.post`: User connected
- `whapi.users.delete`: User disconnected
- `whapi.labels.post`: Label created
- `whapi.labels.delete`: Label deleted
- `whapi.calls.post`: Call received

## Xero

Provider family ID: `xero`
Integration target key: `xero-mcp`
Variant ID: `xero-mcp`
Description: Enable Xero API access through Mistle's Xero MCP tools.

Setup methods:

- `oauth2-authorization-code` (redirect): Xero OAuth

Binding tools:

- `xero-mcp`: Xero MCP (default)

## Z.ai

Provider family ID: `zai`
Integration target key: `zai-coding-plan`
Variant ID: `zai-coding-plan`
Description: Enable Z.ai model access with API key authentication.

Setup methods:

- `api-key` (form): API key
