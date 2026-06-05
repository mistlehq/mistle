# Mistle

This context defines the product language used for sandbox profiles, snapshots, sessions, integrations, and triggers.

## Language

**Sandbox profile version**:
A versioned sandbox profile configuration that can be published and used to prepare sandbox sessions.
_Avoid_: Profile revision

**Sandbox profile duplicate**:
A **Sandbox profile** created as a copy of another **Sandbox profile**'s saved configuration and latest usable **Snapshot**.
_Avoid_: Profile clone, duplicated snapshot

**Referenced sandbox profile version**:
The **Sandbox profile version** an object is configured to use or was created from.
_Avoid_: Current version, latest version

**Snapshot**:
A prepared sandbox image for a published **Sandbox profile version**.
_Avoid_: Template, cache

**Base image**:
The configured starting sandbox image used before profile-specific preparation.
_Avoid_: Profile image

**Setup script**:
The full initialization script for preparing a **Snapshot** from a **Base image**.
_Avoid_: Bootstrap script, init script

**Latest saved draft**:
The saved state of a draft **Sandbox profile version**, excluding unsaved editor changes.
_Avoid_: Current draft, local draft

**Setup Assistant**:
A guided agent workspace for helping author a **Setup script** or **Snapshot maintenance script** for a **Sandbox profile version**.
_Avoid_: Setup script test, setup check

**Snapshot maintenance script**:
The version-scoped, publish-free script for **Automatic snapshot refresh** from an existing usable **Snapshot**.
_Avoid_: Maintenance script, setup script variant, refresh script, update script

**Automatic snapshot refresh**:
A schedule that refreshes a published **Sandbox profile version**'s **Snapshot**.
_Avoid_: Auto-refresh, scheduled rebuild

**Snapshot preparation script**:
The script that a snapshot refresh runs while preparing a **Snapshot**.
_Avoid_: Generic script

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

**Trigger**:
A configured event or schedule that starts an agent response.
_Avoid_: Automation

**Duplicated trigger**:
A disabled **Trigger** created as a configuration copy for a **Sandbox profile duplicate**.
_Avoid_: Cloned automation, enabled copy

**Trigger event**:
A provider event that can be selected as the event source for a **Trigger**.
_Avoid_: Webhook event when naming product-facing trigger-builder concepts

**Trigger event parameter**:
A provider event field that can narrow which **Trigger events** match a **Trigger**.
_Avoid_: Filter field

**Trigger event parameter rule**:
A match rule applied to a **Trigger event parameter** when deciding whether a **Trigger event** matches a **Trigger**.
_Avoid_: Exclusion when the rule is one match mode among several

**Trigger conversation**:
A Mistle-owned **Conversation** created or reused while handling a **Trigger** run.
_Avoid_: Automation conversation

**Conversation**:
A logical agent dialogue.
_Avoid_: Bare conversation when ownership matters

**Provider conversation**:
A provider-owned **Conversation** object that implements an agent dialogue in an **Agent runtime**.
_Avoid_: Session when referring generically across providers

**Runtime conversation**:
A **Provider conversation** running within a **Sandbox session**.
_Avoid_: Bare thread, bare session

**Active runtime conversation**:
The **Runtime conversation** currently selected for the chat pane within a **Sandbox session**.
_Avoid_: Active thread when speaking across providers

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

**Sandbox session title**:
The Mistle-owned display title for a **Sandbox session**.
_Avoid_: Conversation name, provider title

**Codex thread**:
A Codex **Runtime conversation**.
_Avoid_: Session, chat tab

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

**Inline composer command**:
A **Composer command** that can be inserted as editable prompt text away from the start of the composer.
_Avoid_: Runtime command, start-only command

**Codex skill mention**:
A `$skill-name` token in Codex composer text that may resolve to an enabled Codex runtime skill when submitted.
_Avoid_: Hardcoded skill, dashboard skill, slash command, selected skill

**Structured Codex skill input**:
A non-visible Codex turn input item that invokes the enabled runtime skill resolved from a submitted **Codex skill mention**.
_Avoid_: Skill mention text, selected skill, dashboard skill

**Skill source path**:
The runtime-provided file path that identifies the skill definition behind a **Codex skill mention**.
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
- A **Sandbox profile duplicate** requires the copied source configuration to have a usable **Snapshot**.
- A **Sandbox profile duplicate** may carry active **Automatic snapshot refresh** execution state.
- A **Sandbox profile duplicate** with copied **Automatic snapshot refresh** uses fresh schedule timing rather than replaying stale source schedule work.
- A **Sandbox profile duplicate** is runnable from the source profile's active published configuration.
- A **Sandbox profile duplicate** may also carry the source profile's **Latest saved draft** as a separate draft **Sandbox profile version**.
- A **Sandbox profile duplicate** has its own display name rather than becoming a new **Sandbox profile version** of the source profile.
- A **Sandbox profile duplicate** should preserve the source profile's configuration references unless a reference is no longer valid.
- A **Sandbox profile duplicate** does not carry source **Snapshot** job history.
- A session, trigger, or other profile-backed object may have a **Referenced sandbox profile version** that differs from the profile's latest published **Sandbox profile version**.
- A **Setup script** prepares a **Snapshot** from a **Base image**.
- **Setup Assistant** starts from a **Latest saved draft** unless the user saves current edits first.
- **Setup Assistant** requires the **Latest saved draft** to have a saved agent integration.
- A **Snapshot maintenance script** prepares a replacement **Snapshot** from an existing usable **Snapshot**.
- A **Snapshot maintenance script** belongs to one **Sandbox profile version** but may be edited without publishing a new version.
- A **Snapshot maintenance script** is the script text saved for the **Sandbox profile version**, not a script file created inside a Setup Assistant sandbox.
- A Setup Assistant sandbox may use temporary script files to validate a **Snapshot maintenance script**, but those files are not the saved **Snapshot maintenance script**.
- Setup Assistant authors and validates a **Snapshot maintenance script**; applying the script happens through the sandbox profile editor.
- A **Snapshot maintenance script** should match the user's stated maintenance intent; repository refresh and dependency or cache warming are separate intents.
- Dependency installs, toolchain installs, package lifecycle scripts, cache warming, and generated asset builds are additional maintenance scopes beyond repository refresh.
- When the user narrows the intended **Snapshot maintenance script** behavior, later fixes should preserve that narrowed maintenance scope.
- A repository-refresh **Snapshot maintenance script** should fail fast when a target repository has uncommitted changes.
- A repository-refresh **Snapshot maintenance script** should update repositories with non-interactive fast-forward-only pulls.
- A repository-refresh **Snapshot maintenance script** should target repositories discovered in the snapshot or named by the user, not repository paths invented from memory.
- When a Setup Assistant finishes authoring or changing a **Snapshot maintenance script**, the final response should include the complete script text that the user can apply.
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
- A **Trigger event** for a provider review-request event should expose the requested reviewer or team as **Trigger event parameters** instead of hardcoding a Mistle reviewer policy.
- A **Trigger event** for a removed provider review request delivers cancellation intent into the **Trigger conversation**; it does not imply hard runtime cancellation.
- A **Trigger event parameter** may have one or more **Trigger event parameter rules**.
- A **Trigger event parameter rule** may include or exclude matching provider event values.
- A first-pass exclusion rule should be an equality negation on a **Trigger event parameter**, not a separate exclusion list.
- Equality-based **Trigger event parameters** may use inclusion or exclusion rules whether their values are selected from provider resources or entered as text.
- A **Trigger event parameter** without a selected or entered value has no **Trigger event parameter rule**.
- Existing equality **Trigger event parameter rules** remain inclusion rules unless the user changes them.
- User-facing labels for **Trigger event parameter rules** should preserve event-specific natural language while representing inclusion or exclusion consistently.
- First-pass **Trigger event parameter** editing should allow at most one **Trigger event parameter rule** per parameter.
- A **Trigger event parameter rule** belongs to one selected **Trigger event** even when another selected **Trigger event** exposes a similar parameter.
- Trigger-builder form state should represent selected **Trigger event parameters** as rules rather than bare values.
- A **Duplicated trigger** is copied only when its **Referenced sandbox profile version** matches the source profile's active published configuration.
- A **Duplicated trigger** excludes one-off scheduled **Trigger** configuration.
- A **Duplicated trigger** must still be valid against current provider and integration capabilities.
- A disabled recurring **Duplicated trigger** has no due schedule work until explicitly enabled.
- A **Trigger** run may create or reuse one **Trigger conversation**.
- A **Trigger conversation** is owned by Mistle, not by an agent runtime provider.
- A **Provider conversation** is owned by an agent runtime provider.
- A **Runtime conversation** is a provider-owned conversation visible inside a **Sandbox session**.
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
- Transcript, active turn state, context usage, and Codex thread actions belong to the **Codex thread**.
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
- The **Original runtime conversation** may be omitted when the current runtime conversation list is incomplete and no explicit provider conversation was supplied.
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
- A **Codex skill mention** is represented as editable prompt text whether the user typed it manually or inserted it from the composer UI.
- A **Codex skill mention** uses the same conservative whitespace-delimited token shape as the Codex skill mention autocomplete.
- A **Codex skill mention** resolves to a **Structured Codex skill input** only when the submitted token identifies exactly one enabled Codex runtime skill.
- A **Skill source path** is required runtime metadata for Codex skill mentions; Codex `skills/list` entries without one are not exposed as mentionable composer skills.
- A **Structured Codex skill input** is derived from submitted **Codex skill mention** text, not from how that text was inserted into the composer.
- A submitted prompt may produce at most one **Structured Codex skill input** for each distinct resolved Codex runtime skill path.
- The Codex submission path resolves **Codex skill mentions** into **Structured Codex skill inputs**; the generic composer only edits and submits prompt text.
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
- "Pi thread" could imply Codex-style thread navigation — resolved: use **Pi conversation** for Pi's runtime-owned chat object.
- "active thread" could imply a different sandbox — resolved: use **Active Codex thread** for the selected chat conversation inside the same **Sandbox session**.
- Switching threads could imply changing the whole workbench — resolved: thread switching changes the **Active Codex thread** without changing the **Sandbox session**.
- "delete session" could mean hard deletion or user-visible removal — resolved: use **Deleted session** for a session hidden from ordinary lists while retaining its historical record.
