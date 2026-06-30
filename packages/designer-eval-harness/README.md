# Designer Eval Harness

Runs Mistle Designer against seeded product state, records the transcript and canvas actions, and evaluates whether the run satisfied a documented expected outcome.

## Commands

```bash
pnpm designer:eval --case github-pr-review-basic
pnpm designer:eval --case ai-software-factory-linear-github
pnpm designer:eval:judge --run .local/designer-evals/runs/<date>/<case>/<run>
pnpm designer:eval:judge --run .local/designer-evals/runs/<date>/<case>/<run> --result-json /tmp/judge-result.json
pnpm designer:eval:clean
```

Eval artifacts are written under `.local/designer-evals/runs/<date>/<case>/<run>/`.

The judge command writes `judge-input.md` for an LLM judge and `judge-result.template.json`.
After an LLM returns JSON matching the judge contract, pass it back with `--result-json` to
validate and render `judge-result.json` plus `judge-result.md`.

## Method

- [Evaluation method](./docs/evaluation-method.md)
- [Judge contract](./docs/judge-contract.md)
- [AI software factory expected outcome](./docs/cases/ai-software-factory.md)
