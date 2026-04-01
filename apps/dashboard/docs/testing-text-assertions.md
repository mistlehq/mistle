# Text Assertions In Dashboard Tests

This dashboard follows a narrow rule for text assertions:

- assert text when the copy itself is the product contract
- do not assert text just to proxy some other behavior

## Core Rule

Use text assertions when the user-visible wording is the thing that matters.

Common valid cases:

- a destructive alert title users must see
- empty-state copy that is part of the intended UX
- button labels or headings that define navigation or actions
- exact error copy that support or product relies on

Do not use text assertions as a substitute for checking state, structure, or behavior.

## Why This Is A Smell

These tests are easy to circumvent and easy to break for the wrong reason.

Examples of weak assertions:

- asserting `"Saving..."` is absent when the real requirement is "no save-status UI is shown"
- asserting `"Saved"` is present when the real requirement is "the mutation completed successfully"
- asserting generic text across the whole screen instead of the relevant container

These tests are a smell because they are:

- copy-coupled
- brittle to harmless wording changes
- easy to satisfy with different but equally weak copy
- often testing implementation detail instead of behavior

## Decision Tree

Before adding `getByText`, `queryByText`, or `findByText`, ask:

1. Is this exact copy part of the user-facing contract?
   If yes, a text assertion may be correct.
2. Am I really trying to verify state or behavior?
   If yes, assert that state or behavior directly.
3. Would the test still be valid if the copy changed to a synonym?
   If no, it is probably a proxy text assertion.
4. Am I searching the whole screen for generic text?
   If yes, that is usually too broad.

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

## Disallowed Or Suspicious Patterns

Be very skeptical of:

- `queryByText("Saving...")`
- `queryByText("Saved")`
- `queryByText("Loading")`
- `queryByText("Success")`
- `queryByText("Done")`
- whole-screen absence checks for generic copy
- tests where changing copy to `Save complete` would bypass the intent

These are usually proxy text assertions, not behavior tests.

## Valid Text Assertions

These are often fine:

- asserting a section heading exists
- asserting an intentional empty state exists
- asserting a specific validation message exists when that copy matters
- asserting a destructive alert explains the failure

The key distinction is whether the text itself is the contract.

## Practical Review Smells

Be suspicious when you see:

- a test name about behavior but an assertion only about text
- generic copy used as a proxy for async state
- whole-screen `queryByText` assertions
- tests that would pass after replacing one weak string with another
- copy assertions for UI that the product explicitly does not care about
