# Abstraction Discipline

Prefer the thinnest abstraction that still encodes a real boundary. Avoid
wrappers that only restate what an underlying library, client, or runtime
already provides.

## Core Rule

Add an abstraction only when it does at least one of these:

- enforces a real invariant
- removes repeated wiring or complexity from callers
- creates a stable boundary that callers should depend on
- normalizes behavior in a way that is precise and reliable

If a wrapper does none of the above, it should usually be removed.

## Prefer Thin Boundaries

A boundary should narrow configuration, supported operations, or policy.

Examples:

- bind repeated configuration once instead of threading it through every call
- expose only the subset of operations a package actually supports

Avoid layers that only rename, forward, or restate what already exists.

Examples:

- trivial factory helpers that only call a constructor
- single-field input objects where a scalar parameter would do
- custom result objects that only restate upstream fields
- interface layers that are not meaningfully different from the concrete class

## Prefer Upstream Types Over Mirror Types

If a local type is just a subset of an upstream type, derive it from the
upstream type instead of rewriting it manually.

Prefer:

- `Pick<>`
- `Omit<>`
- indexed access types like `Config["endpoint"]`
- `NonNullable<>` when the local contract is stricter than the upstream type

Example:

```ts
type Config = {
  endpoint?: ClientConfig["endpoint"];
  credentials?: ClientConfig["credentials"];
  region: NonNullable<ClientConfig["region"]>;
};
```

This keeps local policy explicit while leaving upstream field definitions owned
by the upstream library.

## Use Local Types Only When They Encode Real Policy

A local type is justified when it expresses something the upstream type does
not. A local type should exist because it changes the contract, not because it
restates the upstream shape.

Examples:

- replacing repeated context with construction-time binding
- requiring a field that the upstream client treats as optional
- narrowing a broad input to the exact supported subset

If a local type only changes naming or structure without adding policy or
meaning, it is probably not worth keeping.

## Error Handling

Do not wrap errors unless the wrapper creates a precise and reliable semantic
contract.

Do not relabel an error unless the new label is more exact than the original.

Good reason:

- the code can identify one specific condition exactly and callers benefit from
  handling it semantically

Bad reasons:

- making errors "look cleaner"
- hiding useful dependency or infrastructure details
- collapsing distinct failures into one generic package error

If the underlying dependency already provides meaningful errors and the local
code is not adding reliable interpretation, prefer surfacing those errors
directly.

Preserve diagnosability over artificial neatness.

## Method Signatures

Use the simplest signature that matches the real contract.

- use scalar parameters for scalar operations
- use an input object only when the operation requires multiple fields
- do not wrap a single scalar in an object unless that shape carries actual
  policy

## Stay Close To The Underlying API

If a package is intentionally close to an underlying API, let it
stay close.

That usually means:

- keep the method surface small
- keep the configuration surface explicit
- return upstream outputs when local code is not adding actual output
  normalization
- avoid rewriting response shapes just for cosmetic consistency

Only move further away from the underlying implementation when the code is
actually creating a stronger and easier-to-use contract.

## Testing

Prefer the highest-value test that proves the real path end to end.

Add a lower-level test only when it:

- covers a materially different contract
- isolates a distinct failure mode
- is expected to serve multiple independent consumers

If a stronger test already proves the same path, do not add another test for
overlap alone.

When the underlying API is already clear, prefer using it directly over
restating it locally.
