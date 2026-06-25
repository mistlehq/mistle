# Mistle

This context defines the product language used for sandbox profiles, snapshots, sessions, integrations, and triggers.

## Language

**Sandbox profile version**:
A versioned sandbox profile configuration that can be published and used to prepare sandbox sessions.
_Avoid_: Profile revision

**Sandbox profile version configuration**:
The saved configuration owned by a **Sandbox profile version**.
_Avoid_: External dependency state, integration setting when the setting is not saved on the version

**Sandbox profile duplicate**:
A **Sandbox profile** created as a copy of another **Sandbox profile**'s saved configuration and latest usable **Snapshot**.
_Avoid_: Profile clone, duplicated snapshot

**Referenced sandbox profile version**:
The **Sandbox profile version** an object is configured to use or was created from.
_Avoid_: Current version, latest version

**Source sandbox profile version**:
The published **Sandbox profile version** whose saved configuration a draft **Sandbox profile version** starts from.
_Avoid_: Active version, latest version when publish materialization state matters

**Snapshot**:
A prepared sandbox image for a published **Sandbox profile version**.
_Avoid_: Template, cache

**Base image**:
The configured starting sandbox image used before profile-specific preparation.
_Avoid_: Profile image

**Mistle Designer base image**:
The starting sandbox image used for **Mistle Designer sessions**.
_Avoid_: Base image when referring to user-configured sandbox profile preparation

**Skills source**:
A repository that provides selectable skills for a **Sandbox profile version**.
_Avoid_: Skill repo, skills repository, source repository when the object may be a configured source rather than only a Git repository binding

**Public skills source**:
A **Skills source** that can be read without a Git integration binding.
_Avoid_: Public repo when the repo is being used specifically as a skills source

**Setup script**:
The full initialization script for preparing a **Snapshot** from a **Base image**.
_Avoid_: Bootstrap script, init script

**Latest saved draft**:
The saved state of a draft **Sandbox profile version**, excluding unsaved editor changes.
_Avoid_: Current draft, local draft

**Setup Assistant**:
A guided agent workspace for helping set up a scoped draft **Sandbox profile version**, especially by authoring and validating a **Setup script** or **Snapshot maintenance script**.
_Avoid_: Setup script test, setup check

**Mistle Designer**:
A guided agent workspace for turning a desired background agent into recommended integrations, triggers, and sandbox profile configuration.
_Avoid_: Setup agent, designer agent, Setup Assistant when the task is broader than script authoring

**Mistle Designer session**:
A sandbox-backed **Mistle Designer** workspace backed one-to-one by a sandbox instance with the `designer` purpose.
_Avoid_: Sandbox session when referring to the guided setup workspace rather than the configured agent runtime session
_Code name_: designer

**Designer managed instructions**:
Mistle-owned instructions that guide **Mistle Designer** behavior inside a **Mistle Designer session**.
_Avoid_: Repo guidance, contributor instructions, Designer instructions when the source of authority is ambiguous

**Designer recommendation**:
A structured setup recommendation produced by **Mistle Designer** for integrations, triggers, provider configuration resources, or sandbox profile configuration.
_Avoid_: Chat suggestion when the recommendation has selectable product state

**Designer blueprint**:
A read-only visualization of a **Designer recommendation** before the user confirms product configuration changes.
_Avoid_: Design plan, draft configuration when no product configuration has been saved

**Designer blueprint source file**:
A sandbox file that **Mistle Designer** may use to author a **Designer blueprint** before pushing its contents to the dashboard.
_Avoid_: Designer blueprint when referring to the sandbox-side authoring file
_Default path_: `.mistle/designer/blueprint.json`

**Designer blueprint source document**:
The JSON document stored in a **Designer blueprint source file**.
_Avoid_: Markdown blueprint when the document must be validated before rendering

**Designer blueprint outcome**:
The intended background-agent behavior that a **Designer blueprint** organizes around.
_Avoid_: Step, setup task

**Designer blueprint trigger**:
A trigger represented in a **Designer blueprint** that starts or advances the proposed workflow.
_Avoid_: Workflow event when the concept is the same as the trigger that starts the workflow
_Properties_: May include a **Designer blueprint integration target**, integration label, and event label when known

**Designer blueprint integration target**:
The stable integration target identity attached to a **Designer blueprint trigger** when the proposed trigger source maps to a real Mistle integration target.
_Avoid_: Integration label when the value must resolve product metadata such as the integration logo

**Designer blueprint agent step**:
An agent-performed unit of work represented in a **Designer blueprint**.
_Avoid_: Sandbox profile change when referring to what the agent will do rather than how the profile is configured

**Designer blueprint workflow output**:
A visible result produced by a **Designer blueprint** workflow.
_Avoid_: Provider write when the output is only proposed or may require approval

**Designer blueprint item state**:
The progress state metadata for one item in a **Designer blueprint** source document.
_Avoid_: Live product state when the state is maintained by Mistle Designer

**Runtime approval request**:
A runtime tool call surfaced to the user for approval before the runtime may perform a side-effecting action.
_Avoid_: Provider configuration change when the change has not been approved or applied

**Runtime approval response**:
A user's approve or decline decision for a pending **Runtime approval request**.
_Avoid_: Provider configuration change when the response has not caused a product or provider mutation

**Approved runtime action**:
A side-effecting action that may run only after an explicit **Runtime approval response** and a supported operation path.
_Avoid_: Provider write when no explicit operation handler has executed

**User input request**:
A runtime request that asks the user to answer a structured question before the agent continues.
_Avoid_: Approval request when the user is choosing configuration rather than granting permission

**Dashboard control action**:
A runtime-requested action handled by the dashboard client to control browser-owned workspace state.
_Avoid_: MCP tool when the action is handled by the browser rather than Mistle resource access

**Designer canvas**:
The route-backed workspace surface displayed beside **Mistle Designer** chat.
_Avoid_: Component canvas when the surface embeds ordinary dashboard routes

**Designer canvas tab**:
A named **Designer canvas** slot with its own route and navigation state.
_Avoid_: Page tab when the tab belongs to the designer workspace rather than the routed page

**Designer page**:
The top-level dashboard resource page for starting, listing, and resuming **Mistle Designer sessions**.
_Avoid_: Sandbox profile page when the user is managing Designer workspaces rather than a specific profile

**Agent runtime connection**:
An integration connection selected on a **Sandbox profile version** to supply provider access for the selected **Agent runtime**.
_Avoid_: Agent runtime when referring to the selected connection

**Snapshot maintenance script**:
The version-scoped, publish-free script for **Automatic snapshot refresh** from an existing usable **Snapshot**; compact UI labels may say maintenance script when the snapshot-refresh context is already visible.
_Avoid_: Setup script variant, refresh script, update script

**Automatic snapshot refresh**:
A schedule that refreshes a published **Sandbox profile version**'s **Snapshot**.
_Avoid_: Auto-refresh, scheduled rebuild

**Snapshot preparation script**:
The script that a snapshot refresh runs while preparing a **Snapshot**.
_Avoid_: Generic script

**Runtime plan**:
The compiled sandbox activation configuration for a **Sandbox profile version**.
_Avoid_: Runtime plane, runtime config when referring to the compiled activation shape

**Provider MCP server**:
An external-provider capability selected through an integration binding and exposed to an **Agent runtime** as part of the **Runtime plan**.
_Avoid_: Mistle MCP, agent runtime MCP when the server belongs to a provider integration

**Draft integration connection**:
An **Integration connection** created before all provider setup requirements are satisfied.
_Avoid_: Placeholder connection, fake connection

**Integration connection setup completion**:
The point at which an **Integration connection** has the provider state and credentials needed for its supported behavior.
_Avoid_: Connection creation when provider setup is still incomplete

**Provider placeholder credential**:
A non-secret credential value supplied only to satisfy provider client libraries before managed egress applies the real integration credential.
_Avoid_: Dummy credential when it could be mistaken for real provider access

**Publish-worthy change**:
A change to saved **Sandbox profile version configuration** that justifies creating a new published **Sandbox profile version**.
_Avoid_: No-op publish, external dependency refresh

**Mistle resource access**:
A **Sandbox profile version** setting that lets an agent runtime use Mistle-owned resources through a selected organization API key.
_Avoid_: Allow agent toggle, Mistle MCP toggle

**Mistle capability catalog**:
A Mistle-provided description of product-supported integration, runtime, trigger, provider resource, and setup capabilities that an agent can inspect before deciding which current resources are available or what setup to recommend.
_Avoid_: Designer capability catalog, available capabilities when referring to supportability rather than current organization/profile state

**Mistle Designer resource access**:
A **Mistle Designer session** capability that lets Designer use Mistle-owned resources without selecting an organization API key on a target **Sandbox profile version**.
_Avoid_: Mistle resource access when the access belongs to Designer rather than the target profile

**Collection landing page**:
A top-level page that lists existing product objects and offers the primary action for creating the first one.
_Avoid_: Detail tab, filtered results view

**Resource detail page**:
A page whose primary purpose is viewing or editing one product resource.
_Avoid_: Nested tab, child resource view

**Filtered collection view**:
A narrowed view of a **Collection landing page** based on user-entered criteria.
_Avoid_: Empty state, local table filter

**Routed navigation affordance**:
A user-facing control whose primary purpose is moving to a route-addressable dashboard page.
_Avoid_: Callback navigation, button navigation

**Deleted session**:
A sandbox session intentionally removed from ordinary user-visible session lists while its history remains available for audit and debugging.
_Avoid_: Hard-deleted session, erased session

**Session entry readiness**:
The point at which a session can present its active conversation as usable chat, after transcript hydration or first-turn submission has produced visible conversation state or has already been accepted for that entry turn.
_Avoid_: Sandbox loading when runtime conversation preparation is still in progress, composer loading

**Active conversation readiness**:
The runtime-supplied evidence that the active conversation has enough synchronized state for the shared session workbench to decide **Session entry readiness**.
_Avoid_: Composer readiness, runtime-specific loading state

**Trigger**:
A configured event or schedule that starts an agent response.
_Avoid_: Automation

**Trigger configuration**:
The durable behavior-defining fields of a **Trigger**.
_Avoid_: Trigger summary when the surface must preserve all behavior-affecting fields

**Duplicated trigger**:
A disabled **Trigger** created as a configuration copy for a **Sandbox profile duplicate**.
_Avoid_: Cloned automation, enabled copy

**Trigger event**:
A provider event that can be selected as the event source for a **Trigger**.
_Avoid_: Webhook event when naming product-facing trigger-builder concepts

**Trigger event condition**:
One way a **Trigger** can match a provider event, consisting of a **Trigger event** and the **Trigger event parameter rules** that must match with it.
_Avoid_: Matching clause, repeated event, event card when naming the domain concept

**Associated resource event routing**:
A **Sandbox profile version** runtime-plan behavior that selects which provider events on associated **Routable provider resources** should produce **Association deliveries**.
_Avoid_: Trigger when no Trigger conversation is created, hardcoded association routing

**Trigger event parameter**:
A provider event field that can narrow which **Trigger events** match a **Trigger**.
_Avoid_: Filter field

**Resource-backed Trigger event parameter**:
A **Trigger event parameter** whose selectable values come from synced **Integration connection resources**.
_Avoid_: Trigger resource, resource for trigger

**Trigger event parameter group**:
A provider-defined set of related **Trigger event parameters** that should be configured as one logical trigger-matching choice.
_Avoid_: Parameter layout, control group

**Trigger event parameter rule**:
A match rule applied to a **Trigger event parameter** when deciding whether a **Trigger event** matches a **Trigger**.
_Avoid_: Exclusion when the rule is one match mode among several

**Multi-value trigger event parameter rule**:
A **Trigger event parameter rule** that matches when a **Trigger event parameter** has any one of several configured values.
_Avoid_: Repeated event condition when only the parameter values differ

**Multi-value trigger event parameter**:
A **Trigger event parameter** that is allowed to use a **Multi-value trigger event parameter rule**.
_Avoid_: Multi-select control when naming the provider event field rather than the UI

**Association event parameter rule**:
A match rule applied to an **Association-backed provider event** when deciding whether **Associated resource event routing** should produce an **Association delivery**.
_Avoid_: Trigger event parameter rule when no **Trigger** is involved

**Association event parameter definition**:
A provider-defined description of an **Association-backed provider event** field that can be used by an **Association event parameter rule**.
_Avoid_: Trigger event parameter definition when describing association routing

**GitHub actor filter**:
A trigger filter that matches the GitHub **Provider actor** that performed a provider event.
_Avoid_: Author filter, commenter filter when the filter is over the event sender

**GitHub user**:
A human GitHub account with access to accessible repositories that can appear as a **Provider actor** or human review target.
_Avoid_: Contributor when the person is selected because they can act or review, not because they authored commits

**GitHub team review target**:
A GitHub team selected as the requested review target for a provider pull request review-request **Trigger event**.
_Avoid_: GitHub team identity, organization-qualified team

**GitHub App bot review target**:
A GitHub App bot selected as the requested review target for a provider pull request review-request **Trigger event**.
_Avoid_: GitHub App, bot user, service account

**Provider app manifest**:
A user-visible provider app configuration document that Mistle prepares for creating an integration app in the external provider.
_Avoid_: Hidden app config, generated permissions

**Trigger conversation**:
A Mistle-owned **Conversation** created or reused while handling a **Trigger** run.
_Avoid_: Automation conversation

**Provider resource association**:
A Mistle-owned association between a **Routable provider resource** and the **Sandbox session** used to resolve related provider-event delivery.
_Avoid_: Dynamic resource, resource attachment, conversation mapping

**Routable provider resource**:
An external provider resource whose future provider events can continue an agent loop through a **Provider resource association**.
_Avoid_: Provider object, touched resource

**Provider configuration resource**:
An external provider object used to configure integrations, triggers, or sandbox profile behavior.
_Avoid_: Routable provider resource when future event routing is not the concern

**Integration connection resource selection**:
A user selection of provider resource handles available through an **Integration connection** for configuring Mistle behavior.
_Avoid_: Trigger-only resource selection when the same provider resources are selected outside triggers

**Provider configuration change**:
A user-approved change to an external provider object made while configuring Mistle behavior.
_Avoid_: Provider resource refresh when no provider object is modified

**Provider configuration setup**:
A guided integration setup flow for creating or configuring a provider-side **Provider configuration resource**.
_Avoid_: Provider app setup when the provider object is not an app

**Agent-started Slack thread**:
A **Slack thread** whose root message was created by an agent.
_Avoid_: Slack channel, Slack message, Slack thread when the thread may have been started by a human

**Slack thread**:
A Slack conversation thread identified by its channel and root message.
_Avoid_: Slack channel, Slack message when the intended routing scope is the full thread

**Slack channel trigger parameter**:
A **Multi-value trigger event parameter** that matches the Slack channel carrying a Slack **Trigger event**.
_Avoid_: App mention channel when the parameter applies to Slack events beyond app mentions

**Slack user trigger parameter**:
A **Trigger event parameter** that matches a Slack user ID carried by a Slack **Trigger event**.
_Avoid_: Human user filter when the matching identity may be a bot, linked user when the identity is not tied to a Mistle user

**Slack user group**:
A Slack identity group that can be mentioned in Slack message text.
_Avoid_: Slack user group handle when stable identity is required, Slack user membership group when matching does not depend on membership, Slack channel

**Slack user group mention trigger parameter**:
A **Trigger event parameter** that matches an explicit Slack user group mention carried by a Slack message-like **Trigger event**.
_Avoid_: Slack user group membership filter, team membership filter

**Slack message type trigger parameter**:
A **Trigger event parameter** that matches whether a Slack message-like **Trigger event** is a channel or DM message or a thread reply.
_Avoid_: Thread reply parameter, in-thread filter

**Slack user**:
A Slack identity that can appear in Slack user-ID event fields, whether human, app bot, workflow bot, or Slack-owned special user.
_Avoid_: Linked user when the identity is not tied to a Mistle user, human when the identity may be automated

**Routable provider resource key**:
The provider-derived identity used to match provider events to a **Routable provider resource**.
_Avoid_: Conversation key, group key

**Association-backed provider event**:
A provider event routed through a **Provider resource association** rather than through a **Trigger**.
_Avoid_: Trigger event when no Trigger is involved, ad hoc trigger

**Provider actor**:
An external provider identity that authors or performs provider-side actions.
_Avoid_: User when the actor may be an app, bot, or service account

**GitHub App bot actor**:
A GitHub App bot acting as the **Provider actor** for a provider event.
_Avoid_: GitHub user, reviewer when the bot is the event actor rather than the requested review target

**Slack app bot actor**:
A Slack app bot acting as the **Provider actor** for a provider event.
_Avoid_: Slack user, linked user, bot when the actor must be the integration app's own bot

**Self-authored association event**:
An **Association-backed provider event** authored by the same **Provider actor** Mistle uses for the event's **Integration connection**.
_Avoid_: Duplicate webhook, bot event, loop event

**Association delivery**:
An attempt to deliver an **Association-backed provider event** to its **Routing runtime conversation**.
_Avoid_: Trigger delivery when no Trigger is involved

**Association registration**:
The act of recording a **Provider resource association** after Mistle observes a **Routable provider resource**.
_Avoid_: Resource claim, ownership claim

**Rendered association input**:
The exact text generated from an **Associated resource event routing** selection and delivered to the agent.
_Avoid_: Association payload, raw webhook payload

**Association delivery context**:
Runtime-visible metadata that identifies the **Association delivery** and its source provider event.
_Avoid_: Trigger delivery context when no Trigger is involved

**Rendered trigger input**:
The exact text generated from a **Trigger**'s input template and delivered to the agent.
_Avoid_: Trigger payload, formatted trigger message

**Structured JSON input presentation**:
A dashboard-only display interpretation that may make JSON object spans in a **Runtime user message** easier to read without changing what was delivered to the agent.
_Avoid_: Rendered trigger input, formatted trigger input, trigger input presentation

**Conversation**:
A logical agent dialogue.
_Avoid_: Bare conversation when ownership matters

**Provider conversation**:
A provider-owned **Conversation** object that implements an agent dialogue in an **Agent runtime**.
_Avoid_: Session when referring generically across providers

**Runtime conversation**:
A **Provider conversation** running within a **Sandbox session**.
_Avoid_: Bare thread, bare session

**Runtime user message**:
A user-authored transcript message in a **Runtime conversation**, regardless of whether it originated from the **Session workbench** composer, a **Trigger**, an **Association delivery**, a provider CLI, or another runtime-supported submission path.
_Avoid_: Runtime queued message, trigger payload, association payload

**Runtime context window remaining**:
The estimated remaining capacity in the active **Runtime conversation**'s current model context window.
_Avoid_: Context usage, session statistics, total tokens

**Active runtime conversation**:
The **Runtime conversation** currently selected for the chat pane within a **Sandbox session**.
_Avoid_: Active thread when speaking across providers

**Routing runtime conversation**:
The **Runtime conversation** selected to receive follow-up provider events for a **Provider resource association**.
_Avoid_: Caller conversation, active conversation, current thread

**Original runtime conversation**:
The earliest-created **Runtime conversation** in the **Sandbox session**, unless a provider conversation is explicitly supplied by a triggering system.
_Avoid_: Default conversation, currently active conversation, most recently updated conversation

**Runtime conversation navigator**:
The **Session workbench** side panel for listing, selecting, and starting **Runtime conversations**.
_Avoid_: Thread navigator when speaking across providers

**Runtime conversation lineage**:
The parent-child relationship between **Runtime conversations** when one runtime conversation starts another.
_Avoid_: Thread hierarchy, agent hierarchy

**Parent runtime conversation**:
A **Runtime conversation** that starts another **Runtime conversation**.
_Avoid_: Parent agent, source thread

**Child runtime conversation**:
A **Runtime conversation** started by another **Runtime conversation**.
_Avoid_: Child thread, nested agent

**Billing customer**:
The external billing-provider customer associated with a Mistle organization.
_Avoid_: Billing org

**Mistle organization**:
A tenant boundary containing the product resources its members may use.
_Avoid_: Org when the tenant boundary could be confused with an external organization

**Welcome email**:
A personal onboarding email sent to the first user in a Mistle organization after that organization is created.
_Avoid_: Organization welcome, invite welcome

**Unavailable resource**:
A user-visible resource that is missing, deleted, or outside the user's accessible **Mistle organization** scope.
_Avoid_: Cross-org resource, unauthorized resource

**Permission-denied action**:
An action on an accessible **Mistle organization** resource that the current actor is not allowed to perform.
_Avoid_: Unavailable resource, missing resource

**Jira site name**:
The Atlassian Cloud site subdomain for a Jira Cloud connection.
_Avoid_: Jira org, Jira organization, site URL when referring only to the editable subdomain

**Sandbox session**:
A live sandbox execution environment for an agent session.
_Avoid_: Chat session when referring to runtime tools or sandbox state

**Mistle sandbox provider**:
The customer-facing **Sandbox provider** option where Mistle operates the sandbox and manages the underlying provider choice.
_Avoid_: Managed provider, managed Docker, managed E2B, managed Tensorlake

**Mistle sandbox resource baseline**:
The customer-facing default compute and disk allocation for new or newly selected **Mistle sandbox provider** configurations.
_Avoid_: Provider default, minimum resources

**Sandbox session title**:
The Mistle-owned display title for a **Sandbox session**.
_Avoid_: Conversation name, provider title

**Codex thread**:
A Codex **Runtime conversation**.
_Avoid_: Session, chat tab

**Claude Code runtime**:
An Anthropic Claude Code **Agent runtime**.
_Avoid_: Claude runtime when referring specifically to Claude Code as a Mistle agent runtime

**Codex subagent thread**:
A **Codex thread** that is a **Child runtime conversation** spawned by another **Codex thread**.
_Avoid_: Child thread, agent thread, nested conversation

**Codex Plan mode**:
A Codex collaboration mode that changes how the next Codex turn plans work before implementation. Bare `/plan` switches the active **Codex thread** composer into this mode for future submissions; `/plan <prompt>` submits `<prompt>` immediately in this mode. Plan mode is unavailable during active turns, is scoped to the active **Codex thread**, and remains active until an explicit implementation or mode-switch action returns the thread to Default mode.
_Avoid_: update_plan, plan checklist, generic plan

**Codex clear-context implementation**:
A fresh **Codex thread** started from a completed **Codex Plan mode** proposed plan, seeded with the approved plan as the implementation prompt, and preserving the previous active **Codex thread** working directory.
_Avoid_: compact, same-thread implementation turn, reusing prior model context

**Codex plan implementation confirmation**:
A live, thread-scoped prompt shown after a **Codex Plan mode** turn completes with a proposed plan. It is not shown for hydrated history, for `turn/plan/updated` checklist snapshots, or when queued/pending follow-up work has already superseded the proposed plan.
_Avoid_: replay prompt, checklist approval, cross-thread implementation prompt

**Codex review command**:
A typed Codex **Composer command** that starts a Codex code-review turn. Bare `/review` opens a review-target picker; `/review <instructions>` starts a custom review using those instructions.
_Avoid_: ordinary prompt text, slash autocomplete

**Codex user message**:
A **Runtime user message** in a **Codex thread**, including a **Codex turn-start message** or **Codex steer message**.
_Avoid_: Runtime queued message, trigger payload

**Codex turn-start message**:
A **Codex user message** that begins a new **Working agent turn** in a **Codex thread**.
_Avoid_: Initial transcript placeholder, starting prompt

**Codex steer message**:
A **Codex user message** accepted into an existing active **Working agent turn** in a **Codex thread**.
_Avoid_: Codex queued message, Runtime queued message, Pi follow-up message

**OpenCode session**:
An OpenCode **Runtime conversation**.
_Avoid_: OpenCode thread, sandbox session

**Pi conversation**:
A Pi **Runtime conversation**.
_Avoid_: Pi thread, Codex thread

**Pi CLI launch target**:
The native Pi session file path used to open Pi's TUI for a **Pi conversation** that Pi can resume.
_Avoid_: Pi conversation identity, chat restore id

**Pi image content**:
An image carried as first-class content in a **Pi conversation** message.
_Avoid_: Pi image attachment, Pi uploaded image

**Pi source file reference**:
A file path preserved in a **Pi conversation** message so Pi and the user can identify the source file behind submitted content.
_Avoid_: Pi file content, Pi file attachment

**Pi follow-up message**:
A user message queued for a **Pi conversation** after the current **Working agent turn** finishes.
_Avoid_: Pi steer, Codex queued steer

**Pi active model selection**:
The selected Pi model for a **Pi conversation**, changed through Pi's own runtime model controls.
_Avoid_: Pi prompt model override, Codex config model

**Working agent turn**:
An active agent turn within a runtime conversation, shown while the agent runtime reports that it is processing a user request.
_Avoid_: Working chat group, semantic group

**Active Codex thread**:
The **Codex thread** selected as the **Active runtime conversation**.
_Avoid_: Current session, selected sandbox

**Default Codex thread**:
The non-subagent **Codex thread** selected by a **Session workbench** when no explicit **Active Codex thread** is requested.
_Avoid_: Main thread

**Original Codex thread**:
The **Codex thread** that anchors how a **Session workbench** was opened. For a trigger-started **Session workbench**, this is the **Codex thread** associated with the **Trigger conversation**. For a dashboard-started **Session workbench**, this is the earliest-created non-subagent **Codex thread** known for the **Sandbox session**.
_Avoid_: Trigger thread, default thread, main thread, first visible thread

**Session workbench**:
The dashboard workspace for a **Sandbox session**, including sandbox-scoped tools and runtime-conversation-scoped chat.
_Avoid_: Chat page when referring to the whole workspace

**Session bottom panel**:
The sandbox-scoped lower workbench area used for terminal-style tools within a **Session workbench**.
_Avoid_: Thread panel, Codex thread panel

**Composer capability**:
A special composer interaction available for a session, including how the input is represented while editing and how it is submitted.
_Avoid_: Autocomplete feature, composer shortcut

**Composer draft**:
The current editable session composer content, including the prompt text and any selected mention metadata that may affect submission.
_Avoid_: Composer text, textarea value

**Inline composer command**:
A **Composer command** that can be inserted as editable prompt text away from the start of the composer.
_Avoid_: Runtime command, start-only command

**Codex skill mention**:
A `$skill-name` token in Codex composer text that may resolve to an enabled Codex runtime skill when submitted.
_Avoid_: Hardcoded skill, dashboard skill, slash command

**Selected Codex skill mention**:
A **Codex skill mention** inserted by selecting a specific enabled Codex runtime skill from composer suggestions.
_Avoid_: Typed skill mention, inferred skill, dashboard skill

**Structured Codex skill input**:
A non-visible Codex turn input item that invokes the enabled runtime skill resolved from a submitted **Codex skill mention** or **Selected Codex skill mention**.
_Avoid_: Skill mention text, dashboard skill

**Skill source path**:
The runtime-provided file path that identifies the skill definition behind a **Selected Codex skill mention** or resolved **Codex skill mention**.
_Avoid_: Context path, inserted path, attachment path

**Sandbox profile skills source**:
A Git repository selected on a **Sandbox profile version** as the source of skills that may be made available to agent runtimes.
_Avoid_: Codex skill mention, skill picker source

**Skills loading**:
The operation that scans a **Sandbox profile skills source** and records the skills found for that **Mistle organization** and repository. Skills loading may happen automatically for the first load or manually when a user reloads an already-loaded source.
_Avoid_: Refresh when speaking about the product intent, auto-refresh

**Missing selected skill**:
A skill selected on a **Sandbox profile version** whose name and **Skill source path** are not both present in the loaded **Sandbox profile skills source**.
_Avoid_: Unavailable skill, unavailable source

**Codex slash palette**:
The Codex composer palette opened with `/`, listing **Composer commands** before runtime-discovered **Codex skill mentions**.
_Avoid_: Skill picker, command-only palette

**Context mention**:
A **Session workbench** **Composer capability** selected with `@` that inserts a referenced sandbox workspace path into the composer as prompt text.
_Avoid_: File attachment, uploaded file, file reference

**Sandbox workspace path**:
A file or directory path inside a **Sandbox session** filesystem that can be inserted through a **Context mention**.
_Avoid_: Workspace search result, local file, host path

**Git commit signing**:
A sandbox profile setting that asks Mistle to sign sandbox Git commits as the acting user's linked GitHub identity when signing credentials are available.
_Avoid_: GitHub commit signing selector, signing provider selection

**Identity-linked Git connection**:
A Git connection that can be used to link Mistle users to external Git identities for profile-level Git commit signing.
_Avoid_: Signing-enabled connection, GitHub signing provider

**Identity-linking connection row**:
An organization settings row representing one eligible integration connection and its identity-linking enablement state.
_Avoid_: Provider config row, draft provider row, connection selector row

**Member identity-link status**:
An organization member's linked-or-not-linked state for one identity-linking provider configuration.
_Avoid_: Linked user, linked users count

**Unavailable identity-linking connection row**:
An organization settings row for an existing identity-linking configuration whose integration connection is no longer eligible for identity linking.
_Avoid_: Hidden identity-linking config, orphaned provider row

**Composer command**:
A composer input selected with `/` that submits a command owned by the session's **Agent runtime**.
_Avoid_: Slash autocomplete

**Runtime queued message**:
A composer-submitted user message accepted by an **Agent runtime** for delivery after the current **Working agent turn**.
_Avoid_: Local queued prompt, deferred start turn

**Dashboard build drift**:
A mismatch between the loaded dashboard bundle's release version and the control-plane API release version.
_Avoid_: Build/version drift, asset drift

**Dashboard update affordance**:
A sidebar action shown when **Dashboard build drift** is known.
_Avoid_: Refresh prompt, update modal

**Dashboard drift notice**:
A dismissible dialog shown when **Dashboard build drift** is first detected.
_Avoid_: Schema mismatch prompt, refresh modal

## Relationships

- A **Sandbox profile version** may have one usable **Snapshot**.
- A **Publish-worthy change** is evaluated against the draft's **Source sandbox profile version**.
- A draft **Sandbox profile version**'s **Source sandbox profile version** is the latest earlier published **Sandbox profile version**.
- **Sandbox profile version configuration** excludes external dependency state, snapshot image state, snapshot job history, and other lifecycle timestamps.
- **Sandbox profile version configuration** excludes **Sandbox profile** metadata such as the profile display name.
- A **Snapshot maintenance script** belongs to a **Sandbox profile version** but is not a **Publish-worthy change** by itself.
- **Automatic snapshot refresh** belongs to a published **Sandbox profile version** but is not a **Publish-worthy change** by itself.
- A **Sandbox profile version** without a **Publish-worthy change** should not be publishable.
- A saved draft **Sandbox profile version** without a **Publish-worthy change** may be discarded when it has a **Source sandbox profile version**.
- A saved first draft **Sandbox profile version** is not discarded through the no-change draft cancellation flow.
- **Mistle Designer** writes durable configuration into real product resources such as draft **Sandbox profile versions**, not a separate design-plan resource.
- **Mistle Designer** runs in a **Mistle Designer session**, not an ordinary **Sandbox session**.
- Users may resume existing **Mistle Designer sessions** or start new **Mistle Designer sessions** for existing product resources.
- First-pass **Mistle Designer sessions** are one-to-one with their designer sandbox instance.
- Resuming a **Mistle Designer session** reconnects to its existing designer sandbox instance rather than creating a replacement sandbox instance.
- **Mistle Designer sessions** use a **Mistle Designer base image**.
- The **Mistle Designer base image** is a distinct image contract from the ordinary sandbox **Base image**, even when both references temporarily resolve to the same underlying image.
- The **Mistle Designer base image** is deployment configuration, not a user-editable product resource.
- A **Mistle Designer base image** supplies built-in Designer runtime tooling; a **Runtime plan** activates and configures that tooling for a **Mistle Designer session**.
- **Mistle Designer session** runtime provider selection is deployment configuration, not target **Sandbox profile version configuration**.
- **Mistle Designer sessions** are intended to use Mistle-selected agent runtime and model access rather than the user's sandbox profile runtime selection.
- **Mistle Designer** model access is not an **Agent runtime connection** selected on a target **Sandbox profile version**.
- **Mistle Designer resource access** is distinct from **Mistle resource access** configured on a target **Sandbox profile version**.
- **Mistle Designer resource access** defines technical access authority; approval behavior for mutating actions is a separate **Mistle Designer** interaction policy.
- **Mistle Designer resource access** is scoped to a **Mistle Designer session** and organization rather than one target **Sandbox profile version**.
- **Mistle Designer sessions** persist the user's initial prompt, workspace state, and Codex-backed Designer chat runtime state.
- A **Mistle Designer session** submits its initial prompt as the first Designer chat turn after the Designer sandbox chat runtime is ready.
- The target **Sandbox profile version**'s **Agent runtime** remains a user choice even when authored through **Mistle Designer**.
- First-pass **Mistle Designer sessions** reuse the normal sandbox session workbench transport against the designer sandbox instance.
- Designer-specific control-plane APIs own **Mistle Designer session** metadata, connection-token minting, and **Designer canvas tab** persistence.
- **Designer canvas tabs** are persisted as **Mistle Designer session** workspace state.
- A **Designer blueprint** is opened and reviewed through a **Designer canvas tab**.
- **Designer canvas tabs** do not have a product-defined count limit.
- A **Designer canvas** should not contain multiple **Designer canvas tabs** with the same route.
- A **Dashboard control action** may open one **Designer canvas tab** without taking ownership of the whole **Designer canvas** tab list.
- A **Dashboard control action** that opens a **Designer canvas tab** is not responsible for whether the tab is persisted as **Mistle Designer session** workspace state.
- A **Dashboard control action** is handled only by the currently active dashboard surface that supports it.
- A **Dashboard control action** may open only dashboard-internal routes in **Designer canvas tabs**.
- A **Designer canvas tab** may accept a dashboard-internal route before that route has a supported embedded rendering surface.
- A **Designer page** is the top-level dashboard entry point for **Mistle Designer sessions**.
- The **Designer page** presents a composer for starting a new **Mistle Designer session** before the list of past **Mistle Designer sessions**.
- Submitting the **Designer page** composer creates a **Mistle Designer session**, opens that session's designer workspace, and seeds the first Designer chat turn from the submitted prompt.
- **Mistle Designer session** access is controlled by Designer-specific user organization permissions in the first pass, not API-key scopes.
- A **Designer canvas** may start empty until **Mistle Designer** opens a route-backed tab.
- **Mistle Designer** may open ordinary dashboard routes in **Designer canvas tabs**.
- Updating a **Designer canvas tab** changes that tab's route or navigation state without replacing the **Mistle Designer session** workspace.
- Future **Mistle Designer** work may update a session's runtime setup as selected **Integration connections** become available.
- **Mistle Designer sessions** may use preinstalled tools from the **Mistle Designer base image** and session-time integration access without rebuilding their sandbox image.
- Preinstalled provider CLI tooling in a **Mistle Designer base image** does not imply access to the corresponding **Integration connection**.
- Session-time tool installation in a **Mistle Designer session** is sandbox workspace state produced by the agent, not a change to the **Runtime plan**.
- Future **Mistle Designer session** access to newly selected **Integration connections** may change without changing the **Runtime plan**.
- **Mistle Designer session** setup changes do not automatically change the target **Sandbox profile version configuration**.
- **Mistle Designer** may route a user to an existing integration setup flow rather than creating an **Integration connection** directly.
- Future **Mistle Designer** work should treat **Integration connection** setup as complete when the relevant control-plane resource state exists.
- A **Designer blueprint** may show the intended workflow that future triggers and sandbox profile behavior will implement, but it does not itself save **Sandbox profile version configuration**.
- First-pass **Mistle Designer sessions** have at most one current **Designer blueprint**.
- A **Designer blueprint** may be regenerated or replaced as **Mistle Designer** changes its **Designer recommendation**.
- A **Designer blueprint source document** uses JSON.
- First-pass **Mistle Designer sessions** may use `.mistle/designer/blueprint.json` as the default sandbox-side **Designer blueprint source file** path.
- First-pass **Mistle Designer sessions** define the current **Designer blueprint** from the persisted **Designer canvas tab** entry that contains the pushed **Designer blueprint source document**.
- First-pass **Designer blueprint** updates are pushed to the dashboard as JSON contents rather than read by the dashboard from an arbitrary sandbox path.
- **Designer blueprint** update fails without changing **Designer canvas tab** state when the pushed **Designer blueprint source document** is invalid.
- **Mistle Designer sessions** should not watch or poll a **Designer blueprint source file** for automatic updates.
- A **Designer blueprint** is stored as Mistle-owned product-domain structure, not renderer-specific graph state.
- A first-pass **Designer blueprint source document** describes version, title, outcome, items, links, and actions.
- A first-pass **Designer blueprint source document** describes semantic structure rather than visual coordinates.
- A **Designer blueprint** renderer may derive its visual nodes and edges from the stored **Designer blueprint**.
- A first-pass **Designer blueprint** renderer is visual-only and read-only, with pan and zoom but without visible action buttons, node dragging, or graph editing.
- A **Designer blueprint** is organized process-first: it shows **Designer blueprint triggers**, **Designer blueprint agent steps**, and **Designer blueprint workflow outputs** as the main workflow.
- Trigger source details such as the integration/provider and event should be shown on the trigger item when known.
- A **Designer blueprint integration target** uses the same stable target key as an **Integration target** and may be used by the dashboard to resolve product metadata such as the integration logo.
- **Integration labels** in **Designer blueprint triggers** are display text and should not be used as product identity.
- A **Designer blueprint** supports only workflow item kinds: trigger, agent step, routing policy, and workflow output.
- Product resources such as integrations, provider resources, sandbox profiles, sandbox profile changes, and confirmations are not **Designer blueprint** item kinds. Those decisions belong in chat or later setup-focused canvas tabs after the user aligns on the workflow.
- A **Designer blueprint** may represent multiple triggers entering the same workflow.
- A **Designer blueprint** is explanatory and actionable, but it is not authoritative product state.
- For open-ended build requests, **Mistle Designer** should propose and show a **Designer blueprint** before selecting or mutating specific product resources.
- **Mistle Designer** should not start open-ended design work by inventorying existing **Sandbox profiles** unless the user's request is explicitly about modifying an existing profile or the proposed **Designer blueprint** needs live resource state to be accurate.
- When the target **Sandbox profile** is ambiguous, **Mistle Designer** should discuss "use an existing Sandbox profile" versus "create a new Sandbox profile" in chat after showing the workflow blueprint.
- **Mistle Designer** should use the dashboard control tool to show the **Designer blueprint** for alignment before creating triggers, updating trigger instructions, saving sandbox profile draft changes, or asking narrowly about implementation resources.
- User alignment on a **Designer blueprint** may authorize **Mistle Designer** to create or update the matching saved draft **Sandbox profile version** without a separate per-field confirmation.
- **Mistle Designer** applies aligned **Sandbox profile version configuration** as one draft update, preserving unrelated saved draft configuration on existing drafts.
- When **Mistle Designer** changes **Integration bindings** on a saved draft **Sandbox profile version**, the resulting saved configuration should include the complete intended binding set, including unrelated bindings that remain part of the draft.
- After **Designer blueprint** alignment, **Mistle Designer** may publish a saved draft **Sandbox profile version** when the aligned outcome requires a launchable agent.
- Publishing a **Sandbox profile version** through **Mistle Designer** does not imply starting a **Sandbox session**.
- **Mistle Designer** may discard a saved draft **Sandbox profile version** when discarding that draft is the aligned outcome.
- Setup confirmation may apply integration setup or selection, trigger configuration, sandbox profile draft changes, publish, or session launch only through the corresponding supported product action; it is not represented as a **Designer blueprint** item.
- First-pass **Designer blueprint** actions open existing product surfaces with prefilled state where supported, rather than executing product changes directly from the blueprint.
- A **Designer blueprint** remains useful after confirmation by updating **Designer blueprint item state** metadata such as proposed, needs setup, ready to confirm, applied, or blocked.
- **Designer blueprint item states** are maintained by **Mistle Designer** rather than inferred as a strict live projection of product state.
- First-pass **Designer blueprint** rendering does not show **Designer blueprint item states** in the graph because the canvas is a workflow visualization, not an implementation progress board.
- Future **Mistle Designer** work may support multiple **Designer blueprints** in one **Mistle Designer session**.
- Some **Draft integration connections** need a webhook callback URL before the provider-side **Provider configuration resource** can be created.
- **Provider configuration setup** is generic product flow while its provider-specific fields and instructions belong to the integration definition.
- **Provider configuration setup** reuses **Integration connection setup completion** rules instead of defining a separate completion model.
- A WasenderAPI **Integration connection setup completion** requires both the provider resource credential and the webhook secret used to verify provider deliveries.
- A WasenderAPI **Integration connection setup completion** does not require a remote provider session health check in the first pass.
- First-pass WasenderAPI **Provider configuration setup** guides the user through provider-side configuration rather than creating or updating the provider resource from Mistle.
- Future **Mistle Designer** work may use **User input requests** to collect structured choices before updating a draft **Sandbox profile version**.
- **Mistle Designer** should use **User input requests** one question at a time, even when the underlying runtime can represent multiple questions.
- Future **Mistle Designer** work may save incomplete draft **Sandbox profile version configuration**, but publishing still requires a publishable target **Agent runtime** configuration.
- Future **Mistle Designer** work should present setup guidance as **Designer recommendations** when the user needs to choose, set up, or review product configuration.
- Future **Designer recommendations** should be structured **Mistle Designer session** chat history entries rather than separate recommendation records.
- Future **Mistle Designer** work may select an existing active **Integration connection** for a draft **Sandbox profile version**.
- Future **Mistle Designer** work may prefill **Trigger** configuration, but the user saves or enables the **Trigger** through the normal trigger UI.
- Future **Mistle Designer** work may publish a draft **Sandbox profile version** and start a new **Sandbox session** from the published version.
- **Mistle Designer** requires explicit user confirmation before publishing a **Sandbox profile version**, starting a **Sandbox session**, or performing provider-side mutations.
- A **Sandbox session** started by **Mistle Designer** uses the normal **Session workbench**.
- Future **Mistle Designer** work may read and refresh scoped **Provider configuration resources** needed for the current setup path.
- Future **Mistle Designer** work may make **Provider configuration changes** only after explicit user approval.
- **Runtime approval requests** are the generic mechanism for surfacing side-effecting runtime tool calls to the user; product or provider writes still require an explicit supported operation path after approval.
- First-pass **Mistle Designer sessions** do not require detailed durable activity history for **Provider configuration changes**.
- Publishing the first **Sandbox profile version** is publish-worthy when no **Source sandbox profile version** exists.
- Publishing the first **Sandbox profile version** does not require a **Source sandbox profile version**.
- The latest published **Sandbox profile version** may be inspectable even when no **Sandbox profile version** is active.
- A snapshot-neutral change can still be a **Publish-worthy change**.
- Snapshot reuse depends on a usable **Snapshot**, not only on the **Source sandbox profile version**.
- Unsaved editor changes may become a **Publish-worthy change** after they are saved to the draft **Sandbox profile version**.
- Unsaved editor changes should preserve the user's ability to save a draft even when the **Latest saved draft** has no **Publish-worthy change**.
- Snapshot reuse requires an existing usable **Snapshot** from the previous active **Sandbox profile version**.
- A **Sandbox profile duplicate** requires the copied source configuration to have a usable **Snapshot**.
- A **Sandbox profile duplicate** may carry active **Automatic snapshot refresh** execution state.
- A **Sandbox profile duplicate** with copied **Automatic snapshot refresh** uses fresh schedule timing rather than replaying stale source schedule work.
- A **Sandbox profile duplicate** is runnable from the source profile's active published configuration.
- A **Sandbox profile duplicate** may also carry the source profile's **Latest saved draft** as a separate draft **Sandbox profile version**.
- A **Sandbox profile duplicate** has its own display name rather than becoming a new **Sandbox profile version** of the source profile.
- A **Sandbox profile duplicate** should preserve the source profile's configuration references unless a reference is no longer valid.
- A **Sandbox profile duplicate** does not carry source **Snapshot** job history.
- A session, trigger, or other profile-backed object may have a **Referenced sandbox profile version** that differs from the profile's latest published **Sandbox profile version**.
- A **Trigger** may have multiple **Trigger event conditions**.
- A webhook **Trigger** must have at least one **Trigger event condition**.
- Scheduled **Triggers** do not have **Trigger event conditions**.
- A **Trigger event condition** belongs to exactly one **Trigger**.
- A **Trigger event condition** has exactly one **Trigger event**.
- An existing **Trigger** with multiple selected **Trigger events** is equivalent to one **Trigger event condition** per selected **Trigger event**.
- A **Trigger event condition** matches only when all of its **Trigger event parameter rules** match.
- A **Multi-value trigger event parameter rule** matches when any one of its configured values matches.
- Only a **Multi-value trigger event parameter** may use a **Multi-value trigger event parameter rule**.
- A **Trigger event condition** without a match expression matches every provider event of its **Trigger event** type.
- A **Trigger event condition** may use an advanced match expression that is not fully represented by visible trigger-builder controls.
- A **Trigger event condition** decides whether a provider event matches; conversation grouping, **Rendered trigger input**, and agent instructions belong to the **Trigger**.
- A migrated **Trigger event condition** preserves the matching behavior of the selected **Trigger event** and event-scoped match expression it replaces.
- A provider event that matches multiple **Trigger event conditions** for the same **Trigger** produces at most one **Trigger** run.
- A **Trigger** may contain redundant **Trigger event conditions**; redundancy does not create extra **Trigger** runs.
- The authored order of **Trigger event conditions** is preserved for display and editing but does not affect matching.
- A provider event that matches multiple **Triggers** may produce one **Trigger** run for each matching **Trigger**.
- **Associated resource event routing** belongs to a **Referenced sandbox profile version** and is part of the runtime behavior for sessions started from that version.
- Changing **Associated resource event routing** requires the **Sandbox profile version** publish and **Snapshot** lifecycle rather than changing already-running **Sandbox sessions**.
- First-pass **Associated resource event routing** selects provider event types for associated resources; the **Provider resource association** supplies the resource match.
- Supported **Associated resource event routing** is enabled by default for a sandbox profile version with the corresponding integration.
- First-pass GitHub pull request **Associated resource event routing** covers pull request comments and reviews, not pull request lifecycle state changes.
- First-pass **Association registration** creates **Provider resource associations** only for GitHub pull requests created through managed egress.
- First-pass **Association registration** is reported directly from the data-plane gateway to the control plane.
- The control plane owns **Provider resource association** records even when they reference data-plane sandbox instances.
- A provider webhook event may produce both a **Trigger run** and an **Association delivery**, but it should not produce duplicate **Runtime user messages** in the same **Sandbox session** unless those messages are explicitly configured as distinct.
- When a provider webhook event would otherwise produce duplicate **Runtime user messages** in the same **Sandbox session**, the **Association delivery** is the preferred delivery because it represents the associated provider-resource loop.
- When an **Association delivery** is preferred for a provider webhook event, the duplicate **Trigger** match is not represented as a **Trigger run**.
- Early duplicate **Trigger** suppression depends on an existing **Trigger conversation** route to the same **Sandbox session** as the **Association delivery**; shared **Referenced sandbox profile version** lineage alone does not make two deliveries duplicates.
- A **Trigger** match without an existing **Trigger conversation** route is not an early duplicate of an **Association delivery**.
- Early duplicate **Trigger** suppression uses the **Trigger** match's rendered conversation key to identify the existing **Trigger conversation** that would receive the provider webhook event.
- Duplicate **Trigger** suppression filters matching **Trigger** targets before **Trigger run** creation.
- First-pass provider webhook delivery creates at most one **Association delivery** for a matched provider resource because **Provider resource associations** are single-owner per integration connection, resource kind, and provider resource id.
- Duplicate **Trigger** suppression depends on queued **Association deliveries** for the same provider webhook event, not merely on the existence of a **Provider resource association**.
- Duplicate **Trigger** suppression does not hide malformed **Trigger** conversation routing; if the conversation key cannot be rendered during suppression, the **Trigger** match is not suppressed and any **Trigger** failure remains explicit in the Trigger path.
- First-pass duplicate **Trigger** suppression does not expose a user-configurable deliver-both mode.
- A **Setup script** prepares a **Snapshot** from a **Base image**.
- **Setup Assistant** starts from a **Latest saved draft** unless the user saves current edits first.
- **Setup Assistant** requires the **Latest saved draft** to have a saved **Agent runtime connection** that is compatible with the selected **Agent runtime**.
- **Setup Assistant** start eligibility is a product contract, not only dashboard guidance.
- **Setup Assistant** is scoped to draft editing and cannot remain open after its **Sandbox profile version** is published.
- **Setup Assistant** may save broader **Sandbox profile version configuration** changes needed for setup, such as integration bindings or runtime configuration, rather than only saving script text.
- **Setup Assistant** changes remain bounded by the scoped **Sandbox profile** and **Sandbox profile version** it was opened for.
- Publishing a **Sandbox profile version** requires closing any open **Setup Assistant** before the profile version changes state.
- Publishing a **Sandbox profile version** still saves ordinary profile editor draft changes, but does not preserve Setup Assistant work that has not been saved back to the draft.
- When unsaved editor changes would make an ineligible **Latest saved draft** eligible for **Setup Assistant**, the user must save the draft before starting **Setup Assistant**.
- When unsaved editor changes would make an eligible **Latest saved draft** ineligible for **Setup Assistant**, the user may still start **Setup Assistant** from the **Latest saved draft** by explicitly choosing to use saved draft data.
- A **Snapshot maintenance script** prepares a replacement **Snapshot** from an existing usable **Snapshot**.
- A **Snapshot maintenance script** belongs to one **Sandbox profile version** but may be edited without publishing a new version.
- A **Snapshot maintenance script** is the script text saved for the **Sandbox profile version**, not a script file created inside a Setup Assistant sandbox.
- A Setup Assistant sandbox may use temporary script files to validate a **Snapshot maintenance script**, but those files are not the saved **Snapshot maintenance script**.
- Setup Assistant authors and validates a **Snapshot maintenance script**; saving the script happens through MCP when available.
- A **Snapshot maintenance script** should match the user's stated maintenance intent; repository refresh and dependency or cache warming are separate intents.
- Dependency installs, toolchain installs, package lifecycle scripts, cache warming, and generated asset builds are additional maintenance scopes beyond repository refresh.
- When the user narrows the intended **Snapshot maintenance script** behavior, later fixes should preserve that narrowed maintenance scope.
- A repository-refresh **Snapshot maintenance script** should fail fast when a target repository has uncommitted changes.
- A repository-refresh **Snapshot maintenance script** should update repositories with non-interactive fast-forward-only pulls.
- A repository-refresh **Snapshot maintenance script** should target repositories discovered in the snapshot or named by the user, not repository paths invented from memory.
- When a Setup Assistant cannot save a completed **Snapshot maintenance script** through MCP, its final response should include the complete script text that the user can copy into the editor.
- A Setup Assistant should validate a runnable **Snapshot maintenance script** by running it when practical; syntax checks alone do not prove the maintenance behavior works.
- Validation should run the exact candidate **Snapshot maintenance script** body, not manually equivalent commands.
- Running a **Snapshot maintenance script** is practical when it exercises the intended maintenance behavior without destructive side effects, secret-dependent prompts, disproportionate runtime, or known environment mismatch.
- **Automatic snapshot refresh** uses the latest saved **Snapshot maintenance script** at execution time when one is present; otherwise it uses the **Setup script**.
- A **Duplicated trigger** does not start agent responses until explicitly enabled.
- Unsaved **Snapshot maintenance script** edits do not affect **Automatic snapshot refresh**.
- Saving **Automatic snapshot refresh** also saves **Snapshot maintenance script** edits.
- Disabling **Automatic snapshot refresh** does not delete the saved **Snapshot maintenance script**.
- Opening **Setup Assistant** does not save, discard, or exit **Automatic snapshot refresh** edits.
- A manual **Snapshot maintenance script** refresh is available only when **Automatic snapshot refresh** is enabled, a saved **Snapshot maintenance script** is present, and the **Sandbox profile version** has a usable **Snapshot**.
- A **Snapshot preparation script** is either the **Setup script** or the **Snapshot maintenance script** used by a refresh execution.
- A **Runtime plan** is applied when preparing a **Snapshot** and when starting a **Sandbox session** from a **Snapshot**.
- A **Snapshot** proves that its **Sandbox profile version** can be prepared with that version's sandbox resources.
- Changing a **Sandbox profile version**'s selected **Agent runtime** changes snapshot preparation suitability, not only session launch behavior.
- Changing an integration binding may affect either snapshot preparation or only session-time access, depending on what the binding contributes to the **Runtime plan**.
- A **Snapshot maintenance script** test run starts from an existing usable **Snapshot** but does not replace it.
- When a new **Sandbox profile version** is published, the **Snapshot maintenance script** and **Automatic snapshot refresh** definition should be copied forward from the previous version.
- A **Collection landing page** may list **Sandbox profile version** families, triggers, sessions, or organization members.
- A **Resource detail page** has one primary resource that determines whether the page is available.
- A **Filtered collection view** narrows a **Collection landing page** without changing whether the underlying collection exists.
- A **Routed navigation affordance** may point from a **Collection landing page** to a **Resource detail page** or another route-addressable page.
- A **Deleted session** is excluded from ordinary session collection views but is still part of the organization's historical record.
- Any ordinary user-visible session may become a **Deleted session**, regardless of whether it is pending, starting, running, stopped, or failed.
- A **Deleted session** keeps its runtime lifecycle state as historical context.
- A **Deleted session** is not restorable through the ordinary product interface.
- A **Deleted session** is unavailable through ordinary session detail routes.
- A running session may become a **Deleted session** after its deletion is recorded and shutdown is accepted.
- A pending or starting **Deleted session** must not complete startup into a hidden running sandbox.
- Deleting a session does not delete the **Trigger** run or **Trigger conversation** that may have created or used it.
- Deleting an existing **Deleted session** again is still considered a successful deletion request.
- A resource outside the user's accessible **Mistle organization** scope is an **Unavailable resource**.
- A **Permission-denied action** is distinct from an **Unavailable resource** because the resource remains visible while the action is blocked.
- An **Unavailable resource** should use the same user-facing pattern across resource types.
- A **Trigger** may select one or more **Trigger events**.
- A **Trigger** may start from a webhook event or a schedule.
- A provider pull request activity should be represented as separate **Trigger events** for each supported activity rather than one broad activity event with an action parameter.
- A **Trigger event** may expose **Trigger event parameters**.
- A **Trigger event parameter group** references two or more **Trigger event parameters**.
- A **Trigger event** for a provider review-request event should expose the requested reviewer or team as **Trigger event parameters** instead of hardcoding a Mistle reviewer policy.
- A **GitHub team review target** matches GitHub's team slug in the provider event payload, not an organization-qualified team identity.
- A **GitHub team review target** can be discovered only from a GitHub organization that owns accessible repositories.
- A **Trigger event** for a removed provider review request delivers cancellation intent into the **Trigger conversation**; it does not imply hard runtime cancellation.
- A **Slack user** may represent a human or bot identity.
- A **Slack user trigger parameter** uses synced **Slack users** as selectable values.
- A **Slack user group mention trigger parameter** matches a mention in event text, not membership of the acting **Slack user**.
- A **Slack user group mention trigger parameter** belongs to message-like Slack **Trigger events**, not reaction **Trigger events**.
- A **Slack user group** is matched by its Slack user group ID rather than its visible handle.
- A synced **Slack user group** does not imply synced group membership.
- Fresh **Slack user** and **Slack user group** selections should represent active provider identities.
- Slack user group membership changes do not change synced **Slack user group** identity selections.
- A **Trigger event parameter** may have one or more **Trigger event parameter rules**.
- A **Trigger event parameter** may require existence when applying a negated **Trigger event parameter rule**.
- A **Trigger event parameter rule** may include or exclude matching provider event values.
- A first-pass exclusion rule should be an equality negation on a **Trigger event parameter**, not a separate exclusion list.
- Equality-based **Trigger event parameters** may use inclusion or exclusion rules whether their values are selected from provider resources or entered as text.
- A **Trigger event parameter** without a selected or entered value has no **Trigger event parameter rule**.
- Existing equality **Trigger event parameter rules** remain inclusion rules unless the user changes them.
- User-facing labels for **Trigger event parameter rules** should preserve event-specific natural language while representing inclusion or exclusion consistently.
- First-pass **Trigger event parameter** editing should allow at most one **Trigger event parameter rule** per parameter.
- A **Trigger event parameter rule** belongs to one selected **Trigger event** even when another selected **Trigger event** exposes a similar parameter.
- Trigger-builder form state should represent selected **Trigger event parameters** as rules rather than bare values.
- A **Resource-backed Trigger event parameter** dropdown offers resource refresh without changing the **Trigger event parameter rule**.
- A **Duplicated trigger** is copied only when its **Referenced sandbox profile version** matches the source profile's active published configuration.
- A **Duplicated trigger** excludes one-off scheduled **Trigger** configuration.
- A **Duplicated trigger** must still be valid against current provider and integration capabilities.
- A disabled recurring **Duplicated trigger** has no due schedule work until explicitly enabled.
- A **Trigger** run may create or reuse one **Trigger conversation**.
- A **Trigger conversation** is owned by Mistle, not by an agent runtime provider.
- A **Provider conversation** is owned by an agent runtime provider.
- A **Runtime conversation** is a provider-owned conversation visible inside a **Sandbox session**.
- A **Provider resource association** belongs to a **Routable provider resource**, not every provider object the agent touches.
- An **Agent-started Slack thread** is a **Routable provider resource**.
- A **Provider resource association** is matched by a **Routable provider resource key**.
- A **Sandbox session** can have many **Provider resource associations**.
- First-pass provider-event delivery does not fan out one **Association-backed provider event** to multiple **Sandbox sessions**.
- **Association delivery** resolves its **Routing runtime conversation** from the associated **Sandbox session**.
- An **Agent runtime** supports **Association delivery** only when Mistle can resolve the **Sandbox session**'s **Original runtime conversation** for that runtime.
- First-pass **Association delivery** resolves the **Routing runtime conversation** from the **Sandbox session**'s **Original runtime conversation**.
- **Association delivery** resolves the **Routing runtime conversation** during delivery, not during provider webhook ingress.
- A **Sandbox session** does not have conflicting **Original runtime conversation** resolution sources; if conflict is detected, the **Trigger conversation** route wins and the conflict is an error.
- An **Association delivery** fails explicitly when its **Routing runtime conversation** cannot be resolved.
- A **Provider resource association** records ownership of a provider resource, not whether future provider events are still useful.
- A **Provider resource association** is not a user-managed dashboard resource.
- **Association registration** does not change whether the provider request that produced the **Routable provider resource** succeeds.
- An **Association-backed provider event** is not a **Trigger** run.
- A **Self-authored association event** does not produce an **Association delivery**.
- A **Slack app bot actor** may author a **Self-authored association event**.
- Slack thread **Association registration** requires a known **Slack app bot actor** for the **Integration connection**.
- A **Provider resource association** can outlive its ability to produce successful **Association deliveries**.
- An **Association delivery** targets the associated **Routing runtime conversation** and does not reroute to another conversation when that target is unavailable.
- An **Association delivery** depends on a **Provider resource association** already recorded when the provider event is handled.
- An **Association delivery** starts a new turn when the **Routing runtime conversation** is idle, steers an active turn when steering is supported, and queues when the runtime cannot steer.
- **Association delivery** idempotency is scoped separately from **Trigger** run idempotency.
- **Association delivery context** is scoped to an **Association delivery**, not to a **Trigger** run.
- **Associated resource event routing** reuses provider event definitions without creating a **Trigger conversation**.
- **Associated resource event routing** uses a **Routable provider resource key** where a **Trigger** uses a conversation key.
- **Associated resource event routing** for an existing **Provider resource association** does not change when a later **Sandbox profile version** is published.
- A **Rendered association input** belongs to **Associated resource event routing**, not to a **Trigger**.
- First-pass **Rendered association input** is concise structured text rather than raw provider-event JSON.
- One provider event may produce both an **Association-backed provider event** and one or more **Trigger** runs.
- A Mistle organization may have one **Billing customer** per billing provider.
- A **Welcome email** is sent once per **Mistle organization**.
- The first user in a newly created **Mistle organization** receives the **Welcome email** after organization initialization succeeds.
- Invited users joining an existing **Mistle organization** do not receive a **Welcome email**.
- A Jira Cloud connection has one **Jira site name**.
- A **Sandbox session** may contain multiple **Codex threads**.
- A **Sandbox session** may contain multiple **OpenCode sessions** when its **Agent runtime** is OpenCode.
- A **Sandbox session** may contain **Pi conversations** when its **Agent runtime** is Pi.
- A trigger-seeded **Sandbox session title** should identify the external work item before the **Trigger** recipe.
- A pull-request trigger-seeded **Sandbox session title** should include the pull request number when available.
- A pull-request trigger-seeded **Sandbox session title** should prefer the pull request title for its topic.
- For Pi, the initial **Sandbox session title** should follow the same Mistle-generated title behavior as other dashboard-started **Sandbox sessions**.
- A **Pi follow-up message** should not seed the **Sandbox session title**.
- Seeding a **Sandbox session title** is a secondary display update and should not block starting the first **Working agent turn**.
- Seeding a **Sandbox session title** should not require renaming the selected **Pi conversation**.
- A **Pi conversation** should remain the selected chat object when the user switches between chat and the Pi CLI.
- A **Pi conversation** is identified in Mistle by the provider session file Pi uses to resume that conversation.
- A **Pi CLI launch target** is the native Pi session file path used to open Pi's TUI; it is not the **Pi conversation** identity used by Mistle chat restore.
- An empty **Pi conversation** is not resumable in the Pi CLI until Pi has materialized conversation content.
- A listed **Pi conversation** should come from Pi session file metadata rather than from switching the active Pi runtime into that conversation.
- A **Session workbench** URL may identify a **Pi conversation** without making the conversation a separate session.
- A **Pi conversation** in the chat pane should expose visible conversation state rather than acting only as a hidden command bridge.
- **Pi image content** belongs to **Pi conversation** messages rather than to a separate Pi upload object.
- A **Pi source file reference** may accompany **Pi image content** to preserve the sandbox path that produced the image.
- Mistle should preserve uploaded Pi images as **Pi source file references** unless Pi itself returns **Pi image content** through its own tools or transcript.
- A non-image uploaded file for Pi should remain a **Pi source file reference** because Pi has no first-class non-image file content API in the current Mistle integration.
- A **Pi source file reference** should use Pi's file-marker language rather than the generic attached-files prompt text.
- Mistle-managed Pi runtimes may require the current Pi conversation contract rather than supporting older Pi builds.
- A **Pi follow-up message** is the Pi runtime equivalent of the composer queue action while a **Working agent turn** is active.
- A **Git commit signing** setting belongs to a **Sandbox profile version** and depends on an **Identity-linked Git connection** being available.
- Changes to an **Identity-linked Git connection** update matching current active and draft **Sandbox profile versions** without creating a new version.
- A **Git commit signing** setting should reference the same Git connection that the **Sandbox profile version** uses for Git access.
- A **Sandbox profile version** uses a Git connection when its Git integration binding references that connection.
- An **Identity-linking connection row** represents a connection, so selecting a different connection would mean selecting a different row.
- An **Unavailable identity-linking connection row** should remain visible so users can understand or disable the existing configuration.
- An **Identity-linking connection row** should have at most one identity-linking configuration for its connection.
- **Member identity-link status** is scoped to one identity-linking provider configuration, not only a provider family.
- A **Working agent turn** is a live conversation state, not a chat semantic group.
- Chat semantic groups describe the specific visible work within a **Working agent turn**, such as thinking, exploring, running commands, or making edits.
- Pi tool execution events are the source of truth for live in-progress chat semantic groups.
- Persisted Pi transcript messages are the source of truth for rebuilding completed chat semantic groups after refresh.
- Pi built-in `read`, `grep`, `find`, and `ls` tool activity maps to the exploring chat semantic group.
- Pi built-in `bash` tool activity maps to the running-commands chat semantic group.
- Pi built-in `edit` and `write` tool activity maps to the making-edits chat semantic group.
- Pi thinking content maps to the thinking chat semantic group.
- Pi extension tool activity maps to the generic tool-call chat semantic group unless the tool has an explicit semantic classifier.
- Pi itself exposes transcript events, message reads, model controls, thinking controls, session stats, image inputs, and runtime commands through its RPC surface.
- The current Mistle Pi adapter may expose a narrower subset than Pi itself; chat UI behavior should follow the adapter contract it has actually wired rather than assuming every upstream Pi RPC command is available.
- Pi composer controls should be Pi-owned controls, not Codex-owned **Composer commands** or Codex context controls.
- Pi **Composer commands** should reflect Pi-owned command sources, including extension commands, prompt template commands, and skill commands.
- Pi extension **Composer commands** are not active-turn steering or queueing messages unless Mistle explicitly supports that interaction.
- Pi prompt-template and skill **Composer commands** may become **Runtime queued messages** through Pi follow-up delivery during an active turn.
- Pi skill **Composer commands** use Pi's `/skill:name` command syntax, not Codex **Codex skill mentions**.
- OpenCode **Composer commands** follow OpenCode's runtime command contract rather than Pi's prompt-template and skill command expansion model.
- A **Session workbench** keeps sandbox-scoped tools stable while the **Active runtime conversation** changes.
- **Pi active model selection** should change Pi runtime state before a prompt is submitted rather than attaching a model override to the prompt.
- **Pi active model selection** belongs to the active **Pi conversation** in the **Session workbench**.
- Mistle displays **Pi active model selection** as a snapshot of Pi runtime state, refreshed when the **Pi conversation** is connected or changed through Mistle.
- The Pi model catalog shown by Mistle should come from Pi's live model controls, not from Mistle's runtime setup files.
- Mistle requests the Pi model catalog for the active **Pi conversation**, not as a workspace-global catalog.
- A **Pi active model selection** is identified by its provider and model id using Pi's canonical provider/model reference.
- Mistle should not show a default marker for Pi model options unless Pi exposes a real default-model concept.
- **Pi active model selection** should not change while the **Pi conversation** has a **Working agent turn**.
- **Pi thinking level** is the Pi-owned control for how much reasoning a thinking-capable Pi model should use.
- **Pi thinking level** is separate from **Pi active model selection** and should not be represented as Codex reasoning effort.
- An **OpenCode model variant** is the OpenCode-owned control for a model-specific reasoning or behavior variant used when starting an OpenCode turn.
- Opening the **Runtime conversation navigator** does not change the **Session bottom panel** state.
- Opening **Codex thread** navigation does not change the **Session bottom panel** state.
- A **Default Codex thread** is used only when the **Session workbench** has no explicit **Active Codex thread** request.
- A **Codex subagent thread** can be selected by explicit **Active Codex thread** request, but is not inferred as the **Default Codex thread**.
- The **Original Codex thread** and **Default Codex thread** may be different **Codex threads**.
- In a trigger-started **Session workbench**, the **Original Codex thread** may differ from the earliest-created **Codex thread** in the **Sandbox session**.
- A trigger-started **Session workbench** resolves its **Original Codex thread** from the **Trigger conversation**, not from **Codex thread** creation order.
- A trigger-started **Session workbench** without a known **Trigger conversation** **Codex thread** has no **Original Codex thread** inferred from creation order.
- A dashboard-started **Session workbench** excludes **Codex subagent threads** when inferring the **Original Codex thread** from creation order.
- The **Original Codex thread** remains stable when the **Active Codex thread** changes within a **Session workbench**.
- An explicit **Active Codex thread** request does not redefine the **Original Codex thread**.
- Ports, terminal access, runtime status, repository filesystem state, and sandbox-level diffs belong to the **Sandbox session**.
- Runtime transcript, active turn state, and **Runtime context window remaining** belong to the **Active runtime conversation**; Codex thread actions belong to the **Codex thread**.
- Goal status belongs to the **Active Codex thread** and is shown with composer-adjacent thread context, not in **Codex thread** navigation.
- Opening a different **Codex thread** is a thread-scoped transition; the previous **Active Codex thread** remains authoritative until the next thread is ready.
- Starting a new **Codex thread** does not create a new **Active Codex thread** until Codex confirms the thread exists.
- The default **Codex thread** navigator scope is the selected primary repository path when one is selected.
- Changing the selected primary repository does not change the **Active Codex thread**.
- A running turn belongs to its **Codex thread** and continues when that thread is no longer the **Active Codex thread**.
- Interrupt and steering controls apply only to the **Active Codex thread**.
- The **Active Codex thread** owns the full live transcript in the chat pane.
- Non-active **Codex threads** may show activity summaries in navigation without rendering full live transcripts.
- Non-active **Codex thread** activity indicators require explicit thread attribution.
- Approval requests for non-active **Codex threads** may be indicated in navigation, but responses happen only after the thread becomes the **Active Codex thread**.
- A **Session workbench** URL may identify an **Active runtime conversation** without making the conversation a separate session.
- A **Session workbench** URL should identify the **Active runtime conversation** with provider-neutral language.
- **Session workbench** URLs should not keep Codex-specific active-conversation parameters as compatibility aliases after migrating to provider-neutral language.
- Within a **Session workbench** URL, `conversationId` identifies the requested **Active runtime conversation**.
- In shared dashboard code, use runtime-conversation language for active-conversation identifiers so they are not confused with Mistle-owned **Trigger conversation** identifiers.
- User-initiated **Active runtime conversation** changes are navigable history within the **Session workbench**.
- User-initiated **Active runtime conversation** URL changes represent confirmed active-conversation changes.
- After a user selects or starts a **Runtime conversation**, the **Session workbench** URL keeps the confirmed `conversationId` explicit, including when the selected conversation is the one selected by default.
- Starting a new **OpenCode session** creates the provider-owned **Runtime conversation** before the **Session workbench** URL changes to its `conversationId`.
- Starting a new **Pi conversation** creates the provider-owned **Runtime conversation** before the **Session workbench** URL changes to its `conversationId`.
- Starting a new **Codex thread** does not create a new **Active runtime conversation** until Codex confirms the thread exists.
- The **Original runtime conversation** remains stable when the **Active runtime conversation** changes within a **Session workbench**.
- A **Runtime conversation navigator** may omit the **Original runtime conversation** when its current runtime conversation list is incomplete and no explicit provider conversation was supplied.
- A **Runtime conversation navigator** uses provider-neutral product language while preserving provider-owned object names in source-specific code and metadata.
- A **Runtime conversation navigator** is labeled as conversations in shared user-facing workbench controls.
- A **Runtime conversation navigator** may use provider-specific row labels when an **Agent runtime** has precise user-facing lineage language.
- A **Runtime conversation navigator** should list real **Runtime conversations** from the active **Agent runtime** rather than presenting a partial active-only placeholder.
- **Runtime conversation lineage** labels are secondary to the **Runtime conversation** title in the **Runtime conversation navigator**.
- The default **Runtime conversation navigator** scope is the selected primary repository path when one is selected.
- **Original runtime conversation** detection is scoped to the **Sandbox session**, not to the current **Runtime conversation navigator** filter.
- First-pass **Runtime conversation** navigation is ordered by recent conversation activity unless the user chooses another view.
- First-pass **Runtime conversation** navigation is flat even when a provider exposes parent-child conversation relationships.
- A flat **Runtime conversation navigator** may still show **Runtime conversation lineage** through visual row cues.
- A **Child runtime conversation** may appear in a **Runtime conversation navigator** even when its **Parent runtime conversation** is not visible.
- **Runtime conversation lineage** requires explicit parent conversation metadata from the **Agent runtime**.
- Visible **Parent runtime conversation** context is optional secondary context for a **Child runtime conversation** row.
- Archived **Parent runtime conversations** are not fetched only to decorate visible **Child runtime conversation** rows.
- A **Runtime conversation navigator** may derive visible lineage depth from currently listed **Runtime conversations**, but visual indentation is capped.
- **Runtime conversation lineage** does not change **Active runtime conversation** selection or **Session workbench** URL behavior.
- A repository-scoped **Runtime conversation navigator** may be empty while the chat pane still shows an **Active runtime conversation** from another path.
- When the **Active runtime conversation** is outside the **Runtime conversation navigator** scope, the UI should make the path mismatch visible.
- Approval requests for non-active **Runtime conversations** may be indicated in navigation when the request has explicit runtime-conversation attribution, but responses happen only after the conversation becomes the **Active runtime conversation**.
- **Child runtime conversation** request indicators are shown on the child row and are not bubbled to the **Parent runtime conversation** row in first-pass navigation.
- First-pass **Runtime conversation** navigation is visible beside the chat pane on desktop and collapses into a drawer on narrow screens.
- First-pass **Runtime conversation** navigation is opened from the **Session workbench** header and occupies the resizable right-side workbench panel.
- Diff review and **Runtime conversation** navigation share the **Session workbench** right-side panel slot.
- When a runtime returns another page of conversation results, the **Runtime conversation navigator** should indicate that only the latest 20 are shown.
- First-pass **Codex thread** navigation does not make **Codex threads** durable Mistle records.
- A loaded **Codex thread** is runtime metadata for navigation, not a separate product category.
- A new **Codex thread** starts from the selected primary repository path when one is selected.
- Archived **Codex threads** are outside first-pass **Codex thread** navigation.
- First-pass **Codex thread** navigation shows the latest unarchived **Codex threads** returned by Codex.
- Right-side panel occupants may have different preferred opening sizes, but user resizing applies to the shared right-side panel slot.
- Switching the open right-side panel between occupants changes content without changing the panel width.
- Opening the right-side panel uses the shared user-resized width when one exists; otherwise it uses the active occupant's preferred opening size.
- The Codex session state owns **Active Codex thread** changes for the **Session workbench**.
- Cached **Codex thread** transcripts are ephemeral **Session workbench** state.
- A cached **Codex thread** transcript does not become visible as active until Codex confirms the thread is resumable.
- A **Codex turn-start message** is the primary user message for a **Working agent turn** in a **Codex thread**.
- A **Codex steer message** belongs to the **Working agent turn** it is accepted into; it is not a **Runtime queued message**.
- A runtime-reported **Runtime user message** belongs in the **Runtime conversation** transcript even when it was submitted outside the current **Session workbench** view.
- A **Runtime queued message** is not a **Runtime user message** until the **Agent runtime** accepts it into the **Runtime conversation** transcript.
- A supported **Agent runtime** adapter must ingest runtime-reported **Runtime user messages** from that runtime's live event stream and hydration source when the runtime exposes them.
- Runtime-specific transcript reducers may use provider-specific reconciliation logic for **Runtime user messages**, but tests should protect the shared behavior at the adapter or reducer boundary.
- **Composer capabilities** may be owned by the **Agent runtime** or by the **Session workbench**.
- An **Agent runtime** is the source of truth for runtime-owned **Composer capabilities**.
- A **Session workbench** is the source of truth for sandbox-scoped **Composer capabilities**.
- A **Composer capability** defines both the editing representation and the submission behavior, not just whether a feature is enabled.
- A **Context mention** belongs to the **Active runtime conversation** when one exists, and otherwise belongs to the **Session workbench**.
- A **Context mention** may appear inline within ordinary composer text or as an argument to a **Composer command**.
- A selected **Context mention** remains editable prompt text after insertion.
- A **Context mention** may refer to a **Sandbox workspace path**.
- A **Runtime queued message** is available only when the **Agent runtime** exposes native queue submission.
- A **Pi follow-up message** is a **Runtime queued message**.
- **Dashboard build drift** can occur while a user keeps the dashboard open across a Mistle deployment.
- **Dashboard build drift** includes cases where the control-plane API does not report its release version.
- A **Dashboard drift notice** can be dismissed for the detected control-plane API release while the **Dashboard update affordance** remains available.
- A **Dashboard update affordance** reloads the dashboard into the current Mistle release.
- The first **Composer commands** are runtime-owned; dashboard UI controls are not **Composer commands**.
- A **Composer command** declares its editing representation separately from whether submission becomes inline prompt text or a typed runtime command.
- A **Composer command** that depends on an optional runtime feature is available only when the **Agent runtime** confirms that feature is enabled.
- A **Composer command** entered before an **Active Codex thread** exists remains a command action until the **Agent runtime** can handle it; it does not become ordinary prompt text.
- A **Composer draft** always has prompt text, and may also have selected mention metadata for runtimes that need structured submission.
- A **Composer draft** may carry selected mention metadata into queued submission intent, but selected mention metadata is not transcript content.
- A **Composer draft** exposes selected mention metadata generically; each **Agent runtime** decides whether and how that metadata affects submission.
- First-pass **Composer draft** selected mention metadata applies to selected skill mentions, not context mentions.
- First-pass **Composer draft** selected mention metadata does not replace text-based **Composer command** handling.
- A Codex queued prompt must not accept **Selected Codex skill mentions** unless the queued path can honor them as structured skill inputs.
- A **Codex skill mention** is represented as editable prompt text whether the user typed it manually or inserted it from the composer UI.
- A **Codex skill mention** and **Selected Codex skill mention** use the same conservative whitespace-delimited token shape as the Codex skill mention autocomplete.
- A **Codex skill mention** resolves to a **Structured Codex skill input** only when the submitted token identifies exactly one enabled Codex runtime skill.
- A **Selected Codex skill mention** may resolve to a **Structured Codex skill input** even when another enabled Codex runtime skill has the same name.
- Manually typed duplicate-name **Codex skill mentions** remain ordinary prompt text unless they become **Selected Codex skill mentions** through explicit user selection.
- A **Selected Codex skill mention** keeps its selected identity through edits around it, but becomes an ordinary **Codex skill mention** when its own visible token no longer exactly matches the selected skill.
- A stale **Selected Codex skill mention** blocks submission rather than silently becoming ordinary prompt text.
- A **Selected Codex skill mention** must be visibly distinguishable from an ordinary **Codex skill mention** while preserving the same prompt text.
- A duplicate-name **Selected Codex skill mention** selection must show enough source identity for the user to choose the intended runtime skill.
- A **Skill source path** is required runtime metadata for Codex skill mentions; Codex `skills/list` entries without one are not exposed as mentionable composer skills.
- A **Structured Codex skill input** for a **Selected Codex skill mention** is derived from the user's explicit composer selection.
- A submitted prompt may produce at most one **Structured Codex skill input** for each distinct resolved Codex runtime skill path, including when multiple **Selected Codex skill mentions** use the same visible name.
- The Codex submission path resolves **Codex skill mentions** and **Selected Codex skill mentions** into **Structured Codex skill inputs**; the generic composer edits a **Composer draft**.
- Codex skill resolution uses the current dashboard **Composer capability** state at submission time rather than calling `skills/list` during submission.
- First-pass **Structured Codex skill input** submission applies to Codex `turn/start`, not Codex steer or queued message submission.
- **Structured Codex skill inputs** do not change the user-visible submitted prompt or transcript text.
- Codex turn submission orders text input first, then any **Structured Codex skill inputs**, then attachments.
- Replacing an existing Codex goal is a confirmed **Composer command** action.
- Editing an existing Codex goal preserves goal state unless the current goal has already reached a terminal state.
- Bare `/review` for the **Codex review command** opens a picker for what to review, not for review style.
- Exec-backed **Codex review command** target pickers use the active **Codex thread** working directory because `review/start` is scoped to a thread.
- The **Codex review command** submits a structured review target to Codex app-server; it does not turn the review target into ordinary prompt text.
- Codex review output uses ordinary chat rendering unless Codex review-mode events are required to keep progress or final output visible.
- The **Codex review command** is unavailable during an active Codex turn.
- Non-empty text after `/review` is custom review instructions, not a structured review-target subcommand.
- A **Sandbox profile version** may use a **Skills source** from a Git integration binding or a **Public skills source**.
- A **Public skills source** does not require a Git integration binding.
- Selected skills change the agent runtime's exposed skills without changing the **Skills source** itself.
- Changing selected skills requires a new **Snapshot** unless the system can prove the selected skill content is already materialized in the reusable **Snapshot**.
- **Mistle resource access** is configured when a **Sandbox profile version** has a selected organization API key for that access.
- **Mistle resource access** is bounded by the selected organization API key's permissions, not by the **Sandbox profile version** that selected the key.
- Changing **Mistle resource access** enablement changes agent runtime setup files and requires a new **Snapshot**.
- Changing only the **Mistle resource access** API key selection with unchanged enablement is session-time credential access.
- The **Mistle sandbox resource baseline** may differ from the underlying provider's own resource defaults.

## Example Dialogue

> **Dev:** "How does **Automatic snapshot refresh** decide whether to run the **Setup script** or **Snapshot maintenance script**?"
> **Domain expert:** "If the target version has a saved **Snapshot maintenance script**, it starts from the existing **Snapshot** and runs that script; otherwise it starts from the **Base image** and runs the **Setup script**."

## Flagged Ambiguities

- "refresh script" could mean either **Setup script** reuse or **Snapshot maintenance script** execution — resolved: use **Snapshot maintenance script** for the lighter existing-snapshot refresh path.
- "auto-refresh" and "scheduled refresh" were used interchangeably — resolved: use **Automatic snapshot refresh** for the product concept.
- "full refresh" was considered for the setup-based refresh path — resolved: use **Setup script** / `setup` when contrasting with **Snapshot maintenance script** / `maintenance`.
- **Snapshot maintenance script** was initially discussed as ordinary versioned profile-version data — resolved: it is scoped to a **Sandbox profile version** but can be updated without publishing a new version or rebuilding from the **Setup script**.
- "Maintenance script" collides with backend maintenance commands — resolved: use **Snapshot maintenance script** in product language.
- "Update repos" was expanded into dependency and cache warming — resolved: keep repository refresh distinct unless the user explicitly asks to warm dependencies, caches, generated assets, or build outputs.
- "Update modules" may mean git submodules, package dependency installs, dependency upgrades, Go modules, cached tool modules, generated assets, or cache warming — unresolved until clarified; do not silently add any of these to a repository-refresh script.
- A queued maintenance refresh was considered as a script-capturing job — resolved for the first implementation: scheduled refresh uses the latest saved **Snapshot maintenance script** at execution time.
- Copied refresh schedules should keep their definition but recompute their next occurrence for the newly published **Sandbox profile version**.
- "empty state" could mean first-use creation guidance, filtered no-results copy, or unavailable dependency copy — resolved: for collection pages, use it to mean the zero-object state before the first item exists.
- "search filtering" could mean client-side filtering of visible rows or a **Filtered collection view** — resolved: collection pages should use a **Filtered collection view** when the result count spans more than the currently loaded page.
- "webhook event" was used for both provider-delivered records and selectable product-facing events in the trigger builder — resolved: use **Trigger event** in product-facing trigger-builder copy and keep webhook event for integration/runtime concepts.
- Trigger-builder UI copy may use "event" for the provider event named on a condition card, but adding another rule bundle should be described as adding a condition.
- Hard migration to **Trigger event conditions** means trigger write paths should reject legacy event-type plus event-scoped-filter trigger writes after cutover.
- **Associated resource event routing** may still use event-type plus event-scoped-filter shapes; the **Trigger event condition** migration is scoped to configured **Triggers**.
- Multi-value **Trigger event parameter rules** should be represented as one any-of-values match for the parameter rather than as repeated **Trigger event conditions**.
- "automation" was used for both the user-facing configured behavior and the internal runtime model — resolved: use **Trigger** as the canonical term across product, API, persistence, and workflow language.
- Dashboard URLs are user-facing language — resolved: use **Trigger** naming for dashboard routes.
- Dashboard route parameters are user-facing route language — resolved: use `triggerId`.
- A unified dashboard trigger detail page should not infer the trigger kind by trying type-specific endpoints — resolved: expose a trigger detail read contract and use it before rendering the type-specific editor.
- The trigger detail read contract should return the same summary shape as the unified trigger list item so the dashboard has one discriminator shape for trigger routing.
- Trigger identifier prefixes were considered during the automation-to-trigger rename — resolved: new **Trigger** records should use trigger-named prefixes, while existing legacy identifiers keep their historical prefixes.
- "automation conversation" was considered as a separate runtime concept — resolved: use **Trigger conversation** for conversations created or reused while handling **Trigger** runs.
- Scheduled action target language used `automation_run` while representing scheduled **Trigger** runs — resolved: use trigger-named target types and payload fields.
- The automation-to-trigger rename was considered as a staged compatibility migration — resolved: ship it as one atomic rename, except for explicit durable workflow compatibility requirements.
- "version" was used ambiguously to mean the latest published **Sandbox profile version** or an object's **Referenced sandbox profile version** — resolved: when describing a session, trigger, or other profile-backed object, use the object's referenced version.
- "billing org" could mean a Mistle organization, a Better Auth organization, or an external billing-provider customer — resolved: use **Billing customer** for the billing-provider customer associated with an existing Mistle organization.
- "org" could mean a **Mistle organization**, an Atlassian organization, or the editable Jira Cloud URL subdomain — resolved: use **Mistle organization** for the tenant boundary and **Jira site name** for the editable Jira Cloud subdomain.
- "no access" could expose that another **Mistle organization** owns a resource — resolved: present missing, deleted, and cross-organization detail links as an **Unavailable resource**.
- "wrong org" could imply that a user should be prompted to switch organizations — resolved: an **Unavailable resource** does not disclose whether another **Mistle organization** would make the resource available.
- "page access error" could imply a global application failure — resolved: an authenticated **Unavailable resource** remains in the product context with ordinary product navigation available.
- "not found" copy alone can be confusing for shared links, while "no access" copy can disclose resource existence — resolved: an **Unavailable resource** may say the page does not exist or the user does not have access.
- Resource-detail pages and settings pages can both fail from access limits — resolved: use **Unavailable resource** for inaccessible resource details and **Permission-denied action** for visible organization areas where the actor lacks a capability.
- Child data on a detail page can fail separately from the primary resource — resolved: when the primary resource is an **Unavailable resource**, the **Resource detail page** shows one unavailable answer rather than child-data failures.
- Deleted resources can be known to the system — resolved: ordinary **Resource detail pages** still present deleted resources as an **Unavailable resource**.
- Shared, deleted, or cross-organization links may resolve to unavailable pages — resolved: visiting an **Unavailable resource** is an ordinary navigation outcome, not an application failure.
- A resource can become unavailable after a **Resource detail page** loads — resolved: the page should converge on the same **Unavailable resource** state.
- An **Unavailable resource** reached through a deep link should keep the attempted location and rely on ordinary product navigation for recovery.
- Unauthenticated deep links may become available after sign-in — resolved: **Unavailable resource** is an authenticated product state, not a replacement for sign-in.
- "chat session" could mean either the live sandbox environment or a Codex conversation — resolved: use **Sandbox session** for the live environment and **Codex thread** for the conversation.
- "default resources" could mean provider-owned capability defaults or the customer-facing **Mistle sandbox resource baseline** — resolved: use **Mistle sandbox resource baseline** for Mistle-owned sandbox-provider defaults.
- "Pi thread" could imply Codex-style thread navigation — resolved: use **Pi conversation** for Pi's runtime-owned chat object.
- "active thread" could imply a different sandbox — resolved: use **Active Codex thread** for the selected chat conversation inside the same **Sandbox session**.
- Switching threads could imply changing the whole workbench — resolved: thread switching changes the **Active Codex thread** without changing the **Sandbox session**.
- "delete session" could mean hard deletion or user-visible removal — resolved: use **Deleted session** for a session hidden from ordinary lists while retaining its historical record.
- "GitHub team" could mean either an organization-scoped GitHub team identity or the requested review target value delivered in a pull request webhook — resolved: use **GitHub team review target** for the trigger-filter value, which is the GitHub team slug.
- "self" in provider-event routing could mean the same Mistle user, same sandbox session, or same provider actor — resolved: use **Self-authored association event** for provider events authored by the same **Provider actor** Mistle uses for the event's **Integration connection**.
- GitHub `user` resources were backed by commit contribution history even though trigger filters used them as actors and review targets — resolved: **GitHub user** resources are access-backed accounts, not contributor-history accounts.
- **GitHub user** was considered as either a free-form login, observed webhook actor, organization member, or repository collaborator — resolved: first-pass **GitHub user** resources are accounts with access to accessible repositories.
- Organization membership alone is too broad for **GitHub user** resources used in repository-scoped trigger filters — resolved: first-pass **GitHub user** resources are based on repository access, not organization membership.
- GitHub App bots can appear alongside human accounts in provider APIs — resolved: keep bots out of **GitHub user** resources and represent them with GitHub App bot terms.
- Human GitHub actor and requested-reviewer trigger filters were considered as separate resource kinds — resolved: both use **GitHub user** resources.
- GitHub team identity changes and GitHub team access changes are distinct — resolved: team identity changes refresh **GitHub team review target** resources, while team membership or repository-access changes can refresh access-backed **GitHub user** resources.
- A GitHub team gaining or losing access to a repository changes repository collaborators, not the integration connection's accessible repository set — resolved: such changes refresh **GitHub user** resources, not repository resources.
- A **GitHub user** resource uses the provider's stable account id for resource identity and the GitHub login as the trigger-matching handle.
- A **GitHub user** resource snapshot should represent the complete collaborator-derived user set for the connection; partial provider discovery failures should make the snapshot unavailable rather than silently incomplete.
- GitHub API-key connections can see repositories that cannot safely enumerate collaborators — resolved: first-pass **GitHub user** resource discovery requires a GitHub App installation connection.
