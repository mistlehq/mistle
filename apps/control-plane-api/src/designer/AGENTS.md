# Designer

- Do not add tests whose only purpose is to assert exact Designer managed-instruction or prompt wording.
- Prefer testing observable Designer behavior, runtime wiring, persisted session state, or structured product contracts instead of prompt substrings.

## Managed Instruction Context

- Keep stable Designer session-agent vocabulary in the `mistle-designer-context` managed instruction block, separate from the `mistle-designer-behavior` block.
- Keep Designer managed instruction content in the canonical Markdown files under `instructions/`. The TypeScript modules under `services/` load those files and the production build copies them into `dist`.
- The context block is the Designer session agent's operating vocabulary. It may repeat product terms from `CONTEXT.md` when those terms matter at runtime, but `CONTEXT.md` remains authoritative for codebase product/domain terms.
- For any Designer terminology, instruction, or context change, route settled terms by authority: update root `CONTEXT.md` only for product/domain concepts that should guide the codebase, and update `mistle-designer-context` only for Designer session-agent wording, user-facing aliases, `_Avoid_` guidance, and `_Maps to_` anchors.
- If a decision affects both product meaning and Designer chat wording, update both surfaces in the same change and keep the `mistle-designer-context` entry mapped back to the `CONTEXT.md` term.
- The context block should define user-facing terms, list terms to avoid, and include concise code/UI anchors with `_Maps to_` when that mapping helps maintainers preserve stable product language.
- Keep the context block about product concepts and wording. Do not use it for behavior rules, tool sequencing, safety policy, implementation plans, or prompt experiments.
- Prefer user-friendly terms where they reduce confusion, but keep already-settled product language when it is clear enough for users. For example, keep "Blueprint" as the chat-facing term and map it to `Designer blueprint` / `tab.kind: "blueprint"`.

## Writing Designer Instructions And References

- Optimize Designer managed instructions and runtime references for predictable Designer process, not exact response wording.
- When debugging live Designer sandbox behavior, extract the raw Codex transcript first with `pnpm dev:designer:transcript -- --container <id-or-name>`. Use the copied rollout JSONL and SQLite state under `.local/designer-transcripts/` as the source of truth before manually spelunking Docker state.
- Put always-needed operating steps, tool sequencing, approval boundaries, and safety rules in `instructions/designer-behavior.md`.
- Treat `instructions/designer-context.md` as always-loaded reference: user-facing vocabulary, terms to avoid, and `_Maps to_` anchors only. Do not put behavior rules there.
- Put branch-specific workflow or provider knowledge in runtime references under `runtime-references/` when the content is reusable, too detailed for the always-loaded behavior file, and has a clear trigger phrase.
- Add a sharp context pointer in `designer-behavior.md` for each runtime reference. The pointer must say when to read the reference and end on a checkable completion criterion, such as reading it before proposing a plan.
- Inline what every Designer run needs. Disclose what only one branch needs behind a runtime reference pointer.
- Runtime references may contain mandatory behavior rules for their branch after the reference is invoked. Keep the invocation pointer in `designer-behavior.md`.
- Keep one authoritative home for each meaning. Do not repeat the same rule across behavior instructions, context vocabulary, and runtime references.
- Improve instructions by subtracting before adding. When behavior is confusing, first look for wording that over-specifies, duplicates, conflicts, or creates the wrong incentive; remove or simplify that wording before adding a new rule.
- Curated runtime references may include prose rules and examples. Generated runtime references, such as the integration catalog, should stay owned by typed product metadata and should not accumulate hand-authored caveats unless the generator has an explicit source field for them.
- Do a scoped pruning pass on the touched section whenever editing Designer instructions or references: remove duplicated meanings, no-op guidance, stale sediment, branch-specific detail that should move behind a reference pointer, and previous fixes that are now made redundant by clearer upstream wording.
- Add or update tests only for structural contracts: runtime wiring, setup-file paths, generated reference contents, size budgets, schema contracts, or eval-protected behavior. Do not test exact prompt wording.
