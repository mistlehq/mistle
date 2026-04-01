# Text Assertions In Dashboard Tests

This dashboard follows a narrow rule for rendered UI assertions:

- default to semantic assertions
- add stable semantic hooks when existing semantics do not expose the needed state
- assert text only when the copy itself is the product contract

When reviewing a text assertion, start with the test's real intent, not the asserted string.

Do not use text as the default way to prove UI state or behavior.

## Default Assertion Strategy

For rendered UI tests, use this order of preference:

1. Existing semantics:
   roles, labels, aria state, disabled state, checked state, expanded state, selected state, row presence, option presence, and scoped container queries
1. Stable semantic hooks:
   add a machine-readable state surface when existing semantics do not expose the behavior the test must distinguish
1. Text assertions:
   use only when the exact wording is the contract

Copy is not a stable default assertion surface.

## Core Rule

Use text assertions when the user-visible wording is the thing that matters.

Common valid cases:

- a destructive alert title users must see
- empty-state copy that is part of the intended UX
- button labels whose exact wording defines navigation or actions
- section headings only when product navigation, information architecture, docs, or support depend on that exact wording
- exact error copy that support or product relies on

Do not use text assertions as a substitute for checking state, structure, or behavior.

Text is not a contract just because it appears in a heading, field title, badge, or summary.

## Add Semantic Hooks When Semantics Do Not Expose State

If a rendered UI test needs to distinguish state and the only observable difference is non-contract copy, add a stable semantic hook and assert that instead.

Do not keep a weak text assertion just because no better selector exists yet.

This applies especially to:

- pending, success, failure, connected, revoked, sent, or similar UI states
- row, badge, or status surfaces that otherwise differ only by visible text
- controls whose availability changes with state
- repeated or portal-rendered UI where text queries are ambiguous

Prefer hooks that expose product state, not presentation.

Good examples:

- `disabled`
- `aria-selected="true"`
- `aria-expanded="false"`
- `data-state="open"`
- `data-feedback-state="sent"`

Bad hooks:

- attributes that simply restate visible copy
- hooks tied to styling rather than state

## Why This Is A Smell

These tests are easy to circumvent and easy to break for the wrong reason.

Examples of weak assertions:

- asserting `"Saving..."` is absent when the real requirement is "no save-status UI is shown"
- asserting `"Saved"` is present when the real requirement is "the mutation completed successfully"
- asserting `"Revoked"` or `"Connected"` when the real requirement is a completed state or available action
- asserting transient status copy like `"Sending..."`, `"Saved"`, `"Sent"`, `"Revoked"`, or `"Connected"` when the real requirement is which control, badge, or action state is visible
- asserting `"Showing 1 of 2"` when the real requirement is filtered results or row count
- asserting generic text across the whole screen instead of the relevant container
- asserting field titles or headings when role or label queries already prove the same thing

These tests are a smell because they are:

- copy-coupled
- brittle to harmless wording changes
- easy to satisfy with different but equally weak copy
- often testing implementation detail instead of behavior
- sometimes redundant with stronger semantic assertions already in the test

## Decision Tree

Before adding `getByText`, `queryByText`, or `findByText`, ask:

1. What behavior is this test actually trying to prove?
   If the answer is state, structure, filtering, visibility, or action availability, prefer an existing semantic assertion.
1. If the current UI does not expose that state semantically, should the test add a stable semantic hook?
   In rendered UI tests, yes.
1. Is this exact copy part of a user-facing contract that product, docs, support, navigation, or UX explicitly care about?
   If yes, a text assertion may be correct.
1. Am I really trying to verify state or behavior?
   If yes, assert that state or behavior directly.
1. Would the test still be valid if the copy changed to a synonym?
   If no, it is probably a proxy text assertion.
1. Am I searching the whole screen for generic text?
   If yes, that is usually too broad.
1. Does a role, label, state, row-count, or other semantic assertion already prove the same thing?
   If yes, the text assertion is probably redundant.

## Preferred Alternatives

### Assert UI State Directly

Bad:

```tsx
expect(screen.queryByText("Saving...")).toBeNull();
```

Better:

```tsx
expect(saveButton.hasAttribute("disabled")).toBe(true);
```

### Prefer Existing Semantics First

Bad:

```tsx
expect(screen.getByText("Connected")).toBeDefined();
```

Better:

```tsx
expect(screen.getByRole("button", { name: "Refresh repositories" })).toBeDefined();
expect(actionMenu).toBeNull();
```

### Add A Semantic Hook When Needed

Bad:

```tsx
expect(screen.getByText("Sent")).toBeDefined();
```

Better:

```tsx
expect(statusElement.getAttribute("data-feedback-state")).toBe("sent");
```

### Assert Structure Instead Of Copy

Bad:

```tsx
expect(screen.getByText("Save failed")).toBeDefined();
```

Better when the exact wording is not the contract:

```tsx
expect(screen.getByRole("alert")).toBeDefined();
```

### Scope Queries To The Relevant Region

Bad:

```tsx
expect(screen.queryByText("Loading")).toBeNull();
```

Better:

```tsx
const dialog = screen.getByRole("dialog");
expect(within(dialog).queryByText("Loading")).toBeNull();
```

Scoping does not fix a weak assertion by itself, but it avoids unrelated failures.

### Assert User Outcomes

Bad:

```tsx
expect(screen.getByText("Saved.")).toBeDefined();
```

Better:

```tsx
expect(screen.getByRole("button", { name: "Edit binding" })).toBeDefined();
```

Or:

```tsx
expect(onClose).toHaveBeenCalled();
```

Use whatever observable outcome actually represents success in that flow.

### Prefer Stronger Semantic Queries Over Duplicate Text Checks

Bad:

```tsx
expect(screen.getByText("Default model")).toBeDefined();
expect(screen.getByLabelText("Default model")).toBeDefined();
```

Better:

```tsx
expect(screen.getByLabelText("Default model")).toBeDefined();
```

If a label, role, state, or container assertion already proves the same thing, extra `getByText` is noise unless that wording itself is the contract.

A stronger assertion elsewhere in the test does not rescue a weak text assertion. Keep the text check only if it proves an independent copy contract.

## Disallowed Or Suspicious Patterns

Be very skeptical of:

- `queryByText("Saving...")`
- `queryByText("Saved")`
- `queryByText("Sent")`
- `queryByText("Revoked")`
- `queryByText("Connected")`
- `queryByText("Loading")`
- `queryByText("Success")`
- `queryByText("Done")`
- `getByText("Showing 1 of 2")`
- `getByText("Showing 2 of 2")`
- field-title or heading assertions used only to prove a form or section rendered
- text assertions duplicated by stronger label/role/state assertions
- `getByText(...)` presence checks for headings, badges, or summaries used to prove a section rendered or disappeared
- whole-screen absence checks for generic copy
- tests where changing copy to `Save complete` would bypass the intent

These are usually proxy text assertions, not behavior tests.

## Valid Text Assertions

These are often fine:

- asserting a section heading exists when the test is explicitly about that heading's wording or accessibility
- asserting an intentional empty state exists
- asserting a specific validation message exists when that copy matters
- asserting a destructive alert explains the failure

The key distinction is whether the text itself is the contract.

A heading, badge, or summary is only a valid text assertion when the test is explicitly about that wording. If it is being used to prove render or hide behavior, completed or pending state, action availability, or filtered counts, treat it as a proxy and prefer semantic assertions.

For pure formatter or view-model tests, asserting user-facing labels can be correct when the purpose of the test is to lock label mapping. This guidance is primarily about rendered UI tests.

## Practical Review Smells

Be suspicious when you see:

- a test name about behavior but an assertion only about text
- generic copy used as a proxy for async state
- transient status labels used to stand in for completed state
- summary text used to stand in for filtered results or counts
- whole-screen `queryByText` assertions
- a heading, field title, or badge used to prove structure instead of wording
- `getByText` repeated alongside stronger semantic assertions for the same UI
- tests that would pass after replacing one weak string with another
- copy assertions for UI that the product explicitly does not care about
