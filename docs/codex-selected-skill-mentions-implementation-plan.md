# Codex Selected Skill Mentions Implementation Plan

This plan implements selected skill disambiguation as one shared composer migration. The product decision lives in [ADR 0006](./adr/0006-codex-skill-mentions-resolve-at-turn-start.md): the session composer moves from a textarea string to a CodeMirror-backed plaintext **Composer draft**, while Codex remains the runtime that turns selected skill metadata into structured Codex skill input items.

## Goals

- Replace the shared session composer textarea with a CodeMirror-backed plaintext composer for all runtimes.
- Change composer state from a string-only value to a **Composer draft** containing prompt text plus selected skill mention metadata.
- Preserve existing slash command, context mention, attachment, model, pending diff comment, steer, interrupt, and queued prompt behavior unless selected skill metadata makes submission invalid.
- Allow a user-selected duplicate-name Codex skill to resolve to its exact `sourcePath`.
- Keep manually typed ambiguous `$skill-name` text as text-only.

## Non-goals

- Do not add Lexical.
- Do not make context mentions or slash commands selected metadata in the first pass.
- Do not persist selected mention metadata into transcript content.
- Do not emit structured Codex skill inputs for Codex steer or queued prompts unless that path is explicitly proven to honor them.

## Implementation Order

1. Introduce generic draft types.
   - Add `ComposerDraft` and `SelectedSkillMention` in the composer/runtime type surface, likely near `apps/dashboard/src/features/pages/session-composer/use-session-composer-state.ts` or a new nearby `session-composer-draft.ts`.
   - Shape:

     ```ts
     export type SelectedSkillMention = {
       name: string;
       sourcePath: string;
       range: { start: number; end: number };
     };

     export type ComposerDraft = {
       text: string;
       selectedSkillMentions: readonly SelectedSkillMention[];
     };
     ```

   - Replace `SessionComposerDraftState.composerText` / `setComposerText` with draft equivalents, while keeping helper accessors for plain text where that keeps the diff readable.

2. Migrate the shared composer editor to CodeMirror.
   - Replace the `Textarea` surface in `apps/dashboard/src/features/chat/components/chat-composer.tsx` with a CodeMirror plaintext editor.
   - Reuse existing dashboard CodeMirror dependencies rather than adding a new editor package.
   - Preserve the existing `ChatComposerViewModel` responsibilities, but change the value/change props to a `ComposerDraft`.
   - Keep the current menu behavior for `/`, `$`, and `@`; the trigger detection helper can stay text/range based if it is editor-agnostic.
   - Ensure keyboard handling still covers submit, secondary submit, menu navigation, escape/dismiss, file paste/drop, and command panel behavior.

3. Track selected skill mention ranges in CodeMirror state.
   - When a skill is selected from `$` or `/` suggestions, insert visible `$name ` text and attach selected metadata `{ name, sourcePath }` to that exact token range.
   - Map selected ranges through ordinary edits using CodeMirror transactions.
   - Invalidate selected metadata when the current range text no longer exactly equals `$${name}` with the accepted whitespace-delimited token shape.
   - Copy/paste should produce ordinary text unless CodeMirror undo restores the original selected range state as part of the editor history.
   - Decorate selected skill mentions so they are visibly distinguishable from typed `$skill-name` text while preserving the prompt text.

4. Disambiguate duplicate skill suggestions.
   - Update skill suggestion rendering in `chat-composer.tsx` so duplicate names show a compact source label derived from `sourcePath`.
   - Keep inserted text as `$name ` only; source labels are chooser UI, not prompt text.
   - Keep full source path available through title/tooltip text.

5. Wire Codex submission.
   - Extend `buildCodexTurnInputItems` in `packages/integrations-definitions/src/agent-runtimes/codex/codex-operations.ts` to accept selected skill mentions.
   - Resolve selected mentions first by exact `sourcePath`, deduping by path.
   - Validate selected mentions against current enabled skill metadata. A stale selected source path must block submission with a clear error.
   - Preserve typed fallback: unique manually typed `$skill-name` tokens produce structured skill items; missing or ambiguous typed names stay text-only.
   - Preserve input ordering: text first, structured skill items next, attachments last.

6. Preserve queue boundaries.
   - `use-session-composer-state.ts` currently queues prompt strings. Update queued prompt state to carry `ComposerDraft` if queued prompts can originate from the shared composer.
   - For Codex active-turn queueing, block selected skill mentions unless the queued path can honor structured skill inputs.
   - Continue draining existing text-only queued prompts with `resolveSkillMentions: false`.

7. Update stories and fixtures.
   - Update existing composer/session stories that pass `composerText`.
   - Add states for duplicate skill suggestions, selected skill token decoration, typed `$skill-name` beside selected `$skill-name`, stale selected skill error, and selected-skill queue blocking.

## Key Files

- `apps/dashboard/src/features/chat/components/chat-composer.tsx`
- `apps/dashboard/src/features/pages/session-composer/use-session-composer-state.ts`
- `apps/dashboard/src/features/pages/session-composer/session-composer-trigger-detection.ts`
- `apps/dashboard/src/features/session-agents/codex/session-state/use-codex-chat-controller.ts`
- `packages/integrations-definitions/src/agent-runtimes/codex/codex-operations.ts`
- `packages/integrations-core/src/agent-runtimes/types.ts`

## Required Tests

- `packages/integrations-definitions/src/agent-runtimes/codex/codex-operations.test.ts`
  - selected metadata resolves duplicate visible names with distinct paths
  - duplicate selected mentions for one path emit one structured item
  - stale selected source path fails
  - typed ambiguous names stay text-only
  - order remains text, skill items, attachments

- `apps/dashboard/src/features/chat/components/chat-composer.component.test.tsx`
  - CodeMirror composer supports typing/submitting existing plain text behavior
  - `/`, `$`, and `@` suggestion flows still work
  - selecting a skill emits visible `$name` plus selected metadata
  - editing inside the selected token removes selected metadata
  - selected token is visibly distinguishable from typed text
  - duplicate skill suggestions show source identity

- `apps/dashboard/src/features/pages/session-composer/use-session-composer-state.component.test.tsx`
  - draft text and selected metadata are submitted together
  - selected Codex skill mentions cannot be queued when the queued path cannot honor them
  - text-only queued prompts continue to drain with skill resolution disabled

- `apps/dashboard/src/features/session-agents/codex/session-state/use-codex-chat-controller.test.ts`
  - direct `turn/start` forwards selected skill metadata into structured Codex input
  - stale selected source path becomes a visible submission error

Run the tests touched above with targeted package commands, then run `pnpm check:fast` before closeout.
