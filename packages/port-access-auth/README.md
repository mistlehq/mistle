# @mistle/port-access-auth

Shared host and bootstrap-token primitives for browser-based Port Access.

Current scope:

- derive and parse canonical Port Access hosts
- mint and verify short-lived Port Access bootstrap tokens

This package does not handle:

- HTTP request parsing
- cookie/session state
- gateway routing
- control-plane authorization
