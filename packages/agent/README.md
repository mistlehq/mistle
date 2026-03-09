# @mistle/agent

Public workspace package for connecting to and interacting with agent runtimes.

## What This Package Owns

This package defines the public `Agent` facade and the `AgentRuntime` contract that runtime-specific integrations implement. Product code such as the dashboard and backend services should target this package rather than constructing provider-specific clients directly. It also owns the generic transport and sandbox session boundary that runtimes connect through.

## Current Scope

This package currently establishes the shared contract only:

- `Agent`
- `AgentRuntime`
- generic runtime metadata
- websocket transport specification
- sandbox session connector and session contracts
- thread and turn operation types

Runtime resolution remains outside this package. Future PRs will add integration-owned runtime registration and concrete runtime implementations on top of this interface.
