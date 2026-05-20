# Typed Runtime Composer Commands

Composer commands that execute immediately and composer commands that require typed arguments have different interaction contracts. We keep immediate runtime commands and typed runtime commands distinct so selecting a command from the composer menu is not conflated with submitting command syntax from the composer text.

`/compact` remains an immediate runtime command because selecting it is the entire action. `/goal` is a typed runtime command because selection only begins an editable command expression, while submit-time parsing owns arguments, subcommands, validation, confirmation, and runtime feature checks.

## Consequences

- The composer capability contract distinguishes immediate command execution from submit-time command parsing.
- Runtime-specific controllers own typed command semantics; the generic composer does not encode Codex goal subcommands.
- Typed runtime commands must fail visibly when unavailable or unsupported, rather than falling through to ordinary prompt text.
