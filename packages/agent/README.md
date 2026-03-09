# @mistle/agent

Public workspace package for connecting to and interacting with agent runtimes.

## What This Package Owns

This package defines the public `Agent` facade and the `AgentRuntime` contract that runtime-specific integrations implement. Product code such as the dashboard and backend services should target this package rather than constructing provider-specific clients directly.

## Current Scope

This package currently establishes the shared contract only:

- `Agent`
- `AgentRuntime`
- runtime metadata
- websocket transport specification
- thread and turn operation types

Future PRs will connect runtime implementations and integration-owned runtime registration into this public interface.
