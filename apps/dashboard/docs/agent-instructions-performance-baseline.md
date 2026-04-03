# Agent Instructions Performance Baseline

This document records a local benchmark baseline for the pure agent-instructions token and completion functions.

It is a reference point for future comparison, not a CI threshold or correctness oracle.

## Command

```sh
pnpm --filter @mistle/dashboard test:bench
```

## Environment

- Date: 2026-04-03
- Commit: `c44eaa3b`
- Node: `v25.6.1`
- pnpm: `10.30.2`

## Key Results

- `completeAgentInstructionToken (10000 tokens)`: mean `0.5365 ms`
- `findMatchingAgentInstructionTokens (10000 tokens)`: mean `0.5391 ms`
- `rankAgentInstructionTokensForMatching (10000 tokens)`: mean `2.2887 ms`
- `buildAgentInstructionTokenCatalog (1000 events)`: mean `6.8609 ms`
- `resolveTemplateTokenContext (100000 chars before token)`: mean `0.0001 ms`

## Notes

- The `10000 tokens` and `1000 events` benchmark sizes are intentionally larger than expected normal dashboard usage.
- These numbers came from a local run, so they should be used for directional comparison rather than exact regression gating.
- If benchmark input sizes or benchmark structure change, record a new baseline instead of comparing directly against this one.
