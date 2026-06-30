# Designer Eval Method

Designer evals check whether Designer turns an open-ended product request into a usable, reviewable Mistle configuration.

## Evaluation Layers

Use deterministic checks for facts the harness can inspect directly:

- whether a blueprint appeared before product mutation
- which dashboard-control actions ran
- which provider resources were saved
- which integration bindings and provider tools are present
- whether the final blueprint includes required provider lifecycle concepts

Use an LLM judge for semantic quality:

- whether the blueprint is concise and understandable
- whether state transitions are clear
- whether setup work is separated from workflow behavior
- whether the handoff is honest about incomplete setup or missing capability
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
- seeded product state
- scripted user inputs
- expected outcome document
- deterministic assertions

The expected outcome document is the contract. It should describe what the user would consider complete and which missing capabilities must be disclosed rather than hidden.

## Reading Results

Start with `evaluation.md`. If deterministic checks fail, inspect `product-state-after.json`, `dashboard-control-actions.jsonl`, and the latest file in `blueprints/`.

If deterministic checks pass but the run still feels wrong, run the judge command and inspect `judge-result.md` and `judge-result.json`.
