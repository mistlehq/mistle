# Designer Eval Judge Contract

The judge classifies a completed eval run from artifacts and the case expected outcome.

## Inputs

The judge receives:

- expected outcome markdown for the case
- `evaluation.md`
- `product-state-before.json`
- `product-state-after.json`
- `dashboard-control-actions.jsonl`
- latest blueprint snapshot, plus earlier snapshots when useful
- `transcript.md`

## Required Output

The judge must emit JSON with this shape:

```json
{
  "verdict": "pass",
  "failureCategory": "none",
  "scores": {
    "conversationFlow": 4,
    "factoryProcessClarity": 4,
    "agentRoleSeparation": 4,
    "feedbackLoopQuality": 4,
    "readinessDisclosure": 4
  },
  "findings": [
    {
      "severity": "low",
      "category": "designer_behavior_issue",
      "evidence": "The blueprint includes the review feedback loop, but the final response does not name the Linear setup that remains.",
      "suggestedFix": "Require the final response to list incomplete provider setup and exact user actions."
    }
  ]
}
```

`verdict` is one of `pass`, `fail`, or `inconclusive`.

`failureCategory` is one of `none`, `harness_issue`, `designer_behavior_issue`, `product_capability_gap`, or `ambiguous_case`.

Scores are integers from 1 to 4:

- `1`: missing or materially wrong
- `2`: partially present but likely confusing or incomplete
- `3`: acceptable with minor gaps
- `4`: clearly satisfies the expected outcome

Score meanings:

- `conversationFlow`: Designer establishes or explicitly invites feedback on the proposed direction before treating a blueprint as accepted or moving into setup/product changes.
- `factoryProcessClarity`: issue readiness rules, workflow states, state-update behavior, and workflow operating process are clear enough for a team to run.
- `agentRoleSeparation`: implementation and review responsibilities are separated when useful, including distinct profile/trigger/instruction recommendations when the product supports them.
- `feedbackLoopQuality`: review findings, coding failures, noisy reviews, and recurring gaps feed back into improved instructions, workflow rules, or review gates.
- `readinessDisclosure`: missing Linear/GitHub setup, missing or preserved agent model-provider setup, unsupported product actions, and exact user actions are disclosed without claiming the factory is ready prematurely.

Findings must cite concrete evidence from artifacts. Do not rely on vibes.

## Judging Rules

- Deterministic failures are authoritative.
- If Designer accurately discloses a missing product capability, classify the missing action as `product_capability_gap`, not `designer_behavior_issue`.
- If Designer claims readiness while required product state is missing, classify as `designer_behavior_issue`.
- If the expected outcome does not define the relevant behavior, classify as `ambiguous_case`.
