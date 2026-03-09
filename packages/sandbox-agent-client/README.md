# @mistle/sandbox-agent-client

Shared client package for opening a sandbox agent channel over WebSocket, completing the sandbox session handshake, and exposing the connected agent stream to higher-level runtime clients.

## What This Package Owns

This package owns the transport/runtime boundary that is common across agent runtimes:

- browser vs Node WebSocket runtime differences
- sandbox agent channel connect handshake
- connection lifecycle state
- parsing incoming JSON-RPC-shaped messages into higher-level events for consumers

It does not own any runtime-specific protocol such as Codex app-server thread and turn operations.

## Usage Direction

Use this package when a higher-level runtime client needs to connect to an agent endpoint inside the sandbox.

Examples:

- `@mistle/codex-app-server-client` should build Codex-specific protocol behavior on top of this package
- integration-owned agent runtime adapters should not reimplement the sandbox agent handshake themselves
