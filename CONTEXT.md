# Mistle

This context defines the product language used for sandbox profiles, snapshots, sessions, integrations, and triggers.

## Language

**Sandbox profile version**:
A versioned sandbox profile configuration that can be published and used to prepare sandbox sessions.
_Avoid_: Profile revision

**Snapshot**:
A prepared sandbox image for a published **Sandbox profile version**.
_Avoid_: Template, cache

**Base image**:
The configured starting sandbox image used before profile-specific preparation.
_Avoid_: Profile image

**Setup script**:
The full initialization script for preparing a **Snapshot** from a **Base image**.
_Avoid_: Bootstrap script, init script

**Maintenance script**:
The version-scoped, publish-free script for refreshing an existing usable **Snapshot** into a replacement **Snapshot**.
_Avoid_: Setup script variant, refresh script, update script

**Snapshot preparation script**:
The script that a snapshot refresh runs while preparing a **Snapshot**.
_Avoid_: Generic script

**Collection landing page**:
A top-level page that lists existing product objects and offers the primary action for creating the first one.
_Avoid_: Detail tab, filtered results view

**Trigger**:
A configured event or schedule that starts an agent response.
_Avoid_: Automation when naming product-facing concepts

**Automation**:
The internal system record and runtime execution model behind a **Trigger**.
_Avoid_: Trigger when naming persistence, API, or workflow contracts

## Relationships

- A **Sandbox profile version** may have one usable **Snapshot**.
- A **Setup script** prepares a **Snapshot** from a **Base image**.
- A **Maintenance script** prepares a replacement **Snapshot** from an existing usable **Snapshot**.
- A **Maintenance script** belongs to one **Sandbox profile version** but may be edited without publishing a new version.
- Scheduled refresh uses the latest saved **Maintenance script** at execution time when one is present; otherwise it uses the **Setup script**.
- A **Snapshot preparation script** is either the **Setup script** or the **Maintenance script** used by a refresh execution.
- A **Maintenance script** test run starts from an existing usable **Snapshot** but does not replace it.
- When a new **Sandbox profile version** is published, the **Maintenance script** and refresh schedule definition should be copied forward from the previous version.
- A **Collection landing page** may list **Sandbox profile version** families, triggers, sessions, or organization members.
- A **Trigger** is backed by one **Automation** record.
- An **Automation** may start from a webhook event or a schedule.

## Example Dialogue

> **Dev:** "How does a scheduled refresh decide whether to run the **Setup script** or **Maintenance script**?"
> **Domain expert:** "If the target version has a saved **Maintenance script**, it starts from the existing **Snapshot** and runs that script; otherwise it starts from the **Base image** and runs the **Setup script**."

## Flagged Ambiguities

- "refresh script" could mean either **Setup script** reuse or **Maintenance script** execution — resolved: use **Maintenance script** for the lighter existing-snapshot refresh path.
- "full refresh" was considered for the setup-based refresh path — resolved: use **Setup script** / `setup` when contrasting with **Maintenance script** / `maintenance`.
- **Maintenance script** was initially discussed as ordinary versioned profile-version data — resolved: it is scoped to a **Sandbox profile version** but can be updated without publishing a new version or rebuilding from the **Setup script**.
- A queued maintenance refresh was considered as a script-capturing job — resolved for the first implementation: scheduled refresh uses the latest saved **Maintenance script** at execution time.
- Copied refresh schedules should keep their definition but recompute their next occurrence for the newly published **Sandbox profile version**.
- "empty state" could mean first-use creation guidance, filtered no-results copy, or unavailable dependency copy — resolved: for collection pages, use it to mean the zero-object state before the first item exists.
- "automation" was used for both the user-facing configured behavior and the internal runtime model — resolved: use **Trigger** for the product-facing concept and **Automation** for persistence, API, and workflow contracts.
- Dashboard URLs are user-facing language — resolved: use **Trigger** naming for dashboard routes, while keeping backend API and persistence contracts under **Automation** unless those contracts are intentionally versioned.
- Dashboard route parameters are user-facing route language — resolved: use `triggerId` for dashboard route-facing code and translate to `automationId` only at backend API/service boundaries.
- A unified dashboard trigger detail page should not infer the trigger kind by trying type-specific endpoints — resolved: expose a backend automation detail read contract and use it before rendering the type-specific editor.
- The backend automation detail read contract should return the same summary shape as the unified automation list item so the dashboard has one discriminator shape for trigger routing.
