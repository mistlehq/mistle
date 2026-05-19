# Mistle

This context defines the product language used for sandbox profiles, snapshots, sessions, integrations, and triggers.

## Language

**Sandbox profile version**:
A versioned sandbox profile configuration that can be published and used to prepare sandbox sessions.
_Avoid_: Profile revision

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

**Filtered collection view**:
A narrowed view of a **Collection landing page** based on user-entered criteria.
_Avoid_: Empty state, local table filter

**Trigger**:
A configured event or schedule that starts an agent response.
_Avoid_: Automation

**Trigger event**:
A provider event that can be selected as the event source for a **Trigger**.
_Avoid_: Webhook event when naming product-facing trigger-builder concepts

**Trigger conversation**:
A conversation created or reused while handling a **Trigger** run.
_Avoid_: Automation conversation

**Billing customer**:
The external billing-provider customer associated with a Mistle organization.
_Avoid_: Billing org

**Jira site name**:
The Atlassian Cloud site subdomain for a Jira Cloud connection.
_Avoid_: Jira org, Jira organization, site URL when referring only to the editable subdomain

**Sandbox session**:
A live sandbox execution environment for an agent session.
_Avoid_: Chat session when referring to runtime tools or sandbox state

**Codex thread**:
A Codex conversation that runs within a **Sandbox session**.
_Avoid_: Session, chat tab

**Active Codex thread**:
The **Codex thread** currently selected for the chat pane within a **Sandbox session**.
_Avoid_: Current session, selected sandbox

**Default Codex thread**:
The **Codex thread** selected by a **Session workbench** when no explicit **Active Codex thread** is requested.
_Avoid_: Main thread

**Session workbench**:
The dashboard workspace for a **Sandbox session**, including sandbox-scoped tools and thread-scoped chat.
_Avoid_: Chat page when referring to the whole workspace

**Session bottom panel**:
The sandbox-scoped lower workbench area used for terminal-style tools within a **Session workbench**.
_Avoid_: Thread panel, Codex thread panel

## Relationships

- A **Sandbox profile version** may have one usable **Snapshot**.
- A session, trigger, or other profile-backed object may have a **Referenced sandbox profile version** that differs from the profile's latest published **Sandbox profile version**.
- A **Setup script** prepares a **Snapshot** from a **Base image**.
- A **Snapshot maintenance script** prepares a replacement **Snapshot** from an existing usable **Snapshot**.
- A **Snapshot maintenance script** belongs to one **Sandbox profile version** but may be edited without publishing a new version.
- **Automatic snapshot refresh** uses the latest saved **Snapshot maintenance script** at execution time when one is present; otherwise it uses the **Setup script**.
- Unsaved **Snapshot maintenance script** edits do not affect **Automatic snapshot refresh**.
- Saving **Automatic snapshot refresh** also saves **Snapshot maintenance script** edits.
- Disabling **Automatic snapshot refresh** does not delete the saved **Snapshot maintenance script**.
- A manual **Snapshot maintenance script** refresh is available only when **Automatic snapshot refresh** is enabled, a saved **Snapshot maintenance script** is present, and the **Sandbox profile version** has a usable **Snapshot**.
- A **Snapshot preparation script** is either the **Setup script** or the **Snapshot maintenance script** used by a refresh execution.
- A **Snapshot maintenance script** test run starts from an existing usable **Snapshot** but does not replace it.
- When a new **Sandbox profile version** is published, the **Snapshot maintenance script** and **Automatic snapshot refresh** definition should be copied forward from the previous version.
- A **Collection landing page** may list **Sandbox profile version** families, triggers, sessions, or organization members.
- A **Filtered collection view** narrows a **Collection landing page** without changing whether the underlying collection exists.
- A **Trigger** may select one or more **Trigger events**.
- A **Trigger** may start from a webhook event or a schedule.
- A **Trigger** run may create or reuse one **Trigger conversation**.
- A Mistle organization may have one **Billing customer** per billing provider.
- A Jira Cloud connection has one **Jira site name**.
- A **Sandbox session** may contain multiple **Codex threads**.
- A **Session workbench** keeps sandbox-scoped tools stable while the **Active Codex thread** changes.
- Opening **Codex thread** navigation does not change the **Session bottom panel** state.
- A **Default Codex thread** is used only when the **Session workbench** has no explicit **Active Codex thread** request.
- Ports, terminal access, runtime status, repository filesystem state, and sandbox-level diffs belong to the **Sandbox session**.
- Transcript, active turn state, context usage, and Codex thread actions belong to the **Codex thread**.
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
- A **Session workbench** URL may identify an **Active Codex thread** without making the thread a separate session.
- User-initiated **Active Codex thread** changes are navigable history within the **Session workbench**.
- User-initiated **Active Codex thread** URL changes represent confirmed active-thread changes.
- After a user selects or starts a **Codex thread**, the **Session workbench** URL keeps the confirmed `threadId` explicit, including when the selected thread is the **Default Codex thread**.
- First-pass **Codex thread** navigation does not make **Codex threads** durable Mistle records.
- **Codex thread** navigation is ordered by recent thread activity unless the user chooses another view.
- A loaded **Codex thread** is runtime metadata for navigation, not a separate product category.
- A new **Codex thread** starts from the selected primary repository path when one is selected.
- First-pass **Codex thread** navigation supports reading, selecting, and starting threads without managing thread lifecycle actions.
- Archived **Codex threads** are outside first-pass **Codex thread** navigation.
- First-pass **Codex thread** navigation is visible beside the chat pane on desktop and collapses into a drawer on narrow screens.
- A repository-scoped **Codex thread** navigator may be empty while the chat pane still shows an **Active Codex thread** from another path.
- When the **Active Codex thread** is outside the navigator scope, the UI should make the path mismatch visible.
- First-pass **Codex thread** navigation shows the latest unarchived **Codex threads** returned by Codex.
- First-pass **Codex thread** navigation is opened from the **Session workbench** header and occupies the resizable right-side workbench panel.
- Diff review and **Codex thread** navigation share the **Session workbench** right-side panel slot.
- Right-side panel occupants may have different preferred opening sizes, but user resizing applies to the shared right-side panel slot.
- Switching the open right-side panel between occupants changes content without changing the panel width.
- Opening the right-side panel uses the shared user-resized width when one exists; otherwise it uses the active occupant's preferred opening size.
- The **Codex thread** navigator groups threads by working directory rather than filtering by repository.
- When Codex returns another page of thread results, the **Codex thread** navigator should indicate that only the latest 20 are shown.
- First-pass **Codex thread** navigation is Codex-specific rather than a generic runtime concept.
- The Codex session state owns **Active Codex thread** changes for the **Session workbench**.
- Cached **Codex thread** transcripts are ephemeral **Session workbench** state.
- A cached **Codex thread** transcript does not become visible as active until Codex confirms the thread is resumable.

## Example Dialogue

> **Dev:** "How does **Automatic snapshot refresh** decide whether to run the **Setup script** or **Snapshot maintenance script**?"
> **Domain expert:** "If the target version has a saved **Snapshot maintenance script**, it starts from the existing **Snapshot** and runs that script; otherwise it starts from the **Base image** and runs the **Setup script**."

## Flagged Ambiguities

- "refresh script" could mean either **Setup script** reuse or **Snapshot maintenance script** execution — resolved: use **Snapshot maintenance script** for the lighter existing-snapshot refresh path.
- "auto-refresh" and "scheduled refresh" were used interchangeably — resolved: use **Automatic snapshot refresh** for the product concept.
- "full refresh" was considered for the setup-based refresh path — resolved: use **Setup script** / `setup` when contrasting with **Snapshot maintenance script** / `maintenance`.
- **Snapshot maintenance script** was initially discussed as ordinary versioned profile-version data — resolved: it is scoped to a **Sandbox profile version** but can be updated without publishing a new version or rebuilding from the **Setup script**.
- "Maintenance script" collides with backend maintenance commands — resolved: use **Snapshot maintenance script** in product language.
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
- "org" could mean a Mistle organization, an Atlassian organization, or the editable Jira Cloud URL subdomain — resolved: use **Jira site name** for the editable Jira Cloud subdomain.
- "chat session" could mean either the live sandbox environment or a Codex conversation — resolved: use **Sandbox session** for the live environment and **Codex thread** for the conversation.
- "active thread" could imply a different sandbox — resolved: use **Active Codex thread** for the selected chat conversation inside the same **Sandbox session**.
- Switching threads could imply changing the whole workbench — resolved: thread switching changes the **Active Codex thread** without changing the **Sandbox session**.
