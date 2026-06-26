# Designer

- Do not add tests whose only purpose is to assert exact Designer managed-instruction or prompt wording.
- Prefer testing observable Designer behavior, runtime wiring, persisted session state, or structured product contracts instead of prompt substrings.

## Managed Instruction Context

- Keep stable Designer session-agent vocabulary in the `mistle-designer-context` managed instruction block, separate from the `mistle-designer-behavior` block.
- Keep Designer managed instruction content in the dedicated TypeScript modules under `services/`. Do not move it to Markdown unless runtime packaging explicitly includes and loads that Markdown file.
- The context block is the Designer session agent's operating vocabulary. It may repeat product terms from `CONTEXT.md` when those terms matter at runtime, but `CONTEXT.md` remains authoritative for codebase product/domain terms.
- The context block should define user-facing terms, list terms to avoid, and include concise code/UI anchors with `_Maps to_` when that mapping helps maintainers preserve stable product language.
- Keep the context block about product concepts and wording. Do not use it for behavior rules, tool sequencing, safety policy, implementation plans, or prompt experiments.
- Prefer user-friendly terms where they reduce confusion, but keep already-settled product language when it is clear enough for users. For example, keep "Blueprint" as the chat-facing term and map it to `Designer blueprint` / `tab.kind: "blueprint"`.
