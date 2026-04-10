# @mistle/published-port-auth

Shared published-port auth primitives for control-plane minting and gateway
verification.

Current scope:

- derive and parse canonical published-port hosts
- mint and verify published-port bootstrap tokens

This package does not handle:

- gateway session cookies
- published HTTP or websocket transport
- dashboard UI concerns
