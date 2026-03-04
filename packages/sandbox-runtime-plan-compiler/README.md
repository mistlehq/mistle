# @mistle/sandbox-runtime-plan-compiler

Compiles sandbox profile versions into runtime plans using integration bindings and an injected
integration target secrets resolver.

This package keeps runtime plan compilation logic app-agnostic so both control-plane-api and
control-plane-worker can reuse the same implementation while choosing their own secret resolution
strategy.
