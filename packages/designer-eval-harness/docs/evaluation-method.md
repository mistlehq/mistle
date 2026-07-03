# Designer Eval Method

Designer evals check whether Designer turns an open-ended product request into a usable, reviewable Mistle configuration.

For AI software factory cases, the expected outcome is an operable team process, not an exact clone of any one orchestration architecture. Designer should define how work becomes ready, how work moves through the issue system, which agent roles own implementation and review, and how the team improves the factory from review findings and failed runs.

## Evaluation Layers

Use deterministic checks for facts the harness can inspect directly:

- whether a blueprint appeared before product mutation
- whether dashboard-mediated product mutation waited until the required follow-up turn
- which dashboard-control actions ran
- which provider resources were saved
- which integration bindings and provider tools are present
- whether the final blueprint includes required provider lifecycle concepts

Use an LLM judge for semantic quality:

- whether the conversation flow creates a clear feedback point before treating a proposed blueprint as accepted
- whether the blueprint is concise and understandable
- whether issue-readiness rules and workflow states are clear
- whether implementation and review responsibilities are separated when the process calls for distinct agent roles
- whether setup work is separated from workflow behavior
- whether the feedback loop can improve both coding and review behavior over time
- whether Designer discloses incomplete setup, missing capability, and exact user actions without overclaiming readiness
- whether the transcript overclaims readiness

The judge must not override deterministic evidence. If product state lacks a required provider tool, the run fails even if the transcript sounds plausible.

## Failure Categories

`harness_issue`: The eval setup, seed state, scripted input, artifact capture, expected outcome, deterministic assertion, or judge prompt is wrong.

`designer_behavior_issue`: Designer had enough capability but planned poorly, skipped verification, saved the wrong configuration, produced a confusing blueprint, or overclaimed readiness.

`product_capability_gap`: Designer should perform or verify a step, but the product does not yet expose the capability. Example: Designer needs to update Linear labels directly but the Designer runtime has no Linear MCP access.

`ambiguous_case`: The expected outcome does not specify enough detail to decide whether the run should pass.

## Case Authoring

Each case should define:

- a user prompt
- optional follow-up user prompts for chat-based alignment after an initial proposal
- seeded product state
- scripted user inputs
- expected outcome document
- deterministic assertions

Use follow-up prompts when the user response is alignment in chat. Use scripted
user inputs only for concrete dashboard decision requests such as repository
selection, status mapping, approval boundary, setup completion, or Run action
approval. Do not script dashboard requests whose only purpose is accepting a
broad blueprint; Designer should ask the user to respond in chat or comment on
the blueprint instead.

The expected outcome document is the contract. It should describe what the user would consider complete and which missing capabilities must be disclosed rather than hidden.

## Reading Results

Start with `evaluation.md`. If deterministic checks fail, inspect `product-state-after.json`, `dashboard-control-actions.jsonl`, and the latest file in `blueprints/`.

If deterministic checks pass but the run still feels wrong, run the judge command and inspect `judge-result.md` and `judge-result.json`.

## Improving Designer

When a case fails, decide whether the fix belongs in product capability work or Designer guidance. Product capability work is required when Designer needs a real action or live state that Mistle does not expose. Designer guidance work is appropriate when Designer had enough product capability but lacked the right process, domain knowledge, or provider-specific setup mapping.

Use [Improving Designer capabilities](./improving-designer-capabilities.md) to decide whether to update managed instructions, add a discoverable reference doc, add a skill, or file product capability work.
