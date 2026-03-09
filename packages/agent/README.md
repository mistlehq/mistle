# @mistle/agent

Public workspace package for connecting to and interacting with agent runtimes.

## Purpose

`@mistle/agent` is the public client surface that product code targets when it needs to talk to an agent runtime running inside a sandbox. Dashboard code, backend services, and future conversation orchestration should depend on this package instead of constructing provider-specific clients directly.

This package owns:

- the public `Agent` facade
- the `AgentRuntime` abstraction that runtime implementations conform to
- the sandbox session boundary that runtimes communicate through
- shared thread and turn operation types
- transport helpers that are generic to the package rather than specific to one runtime

This package does not own runtime resolution. Mapping an integration definition or compiled binding to a concrete `AgentRuntime` implementation belongs to the integration layer.

## Public API

### `Agent`

`Agent` is the primary object that callers use. It owns connection lifecycle and exposes the unified thread and turn operations.

Public responsibilities:

- establish a session using the provided transport and session connector
- connect the selected `AgentRuntime`
- expose runtime-agnostic operations like `startThread`, `readThread`, `resumeThread`, `startTurn`, and `steerTurn`
- close the connected runtime cleanly

### `AgentRuntime`

`AgentRuntime` is the abstraction implemented by provider-specific runtimes. A runtime is responsible for:

- speaking the provider-specific runtime protocol
- mapping unified `Agent` operations to provider-specific operations
- handling provider-specific initialization on top of the package-owned session boundary
- returning a connected runtime instance that serves the unified thread and turn operations

`AgentRuntime` is integration-owned. For example, an OpenAI agent integration variant would export its own `agent-runtime.ts` implementation from `@mistle/integrations-definitions`.

### `AgentSessionConnector`

`AgentSessionConnector` is the package-owned seam for establishing the sandbox session. It hides the session protocol details from runtimes and callers. Runtimes should consume a connected `AgentSession`, not perform the sandbox handshake themselves.

### Transport

Transport details stay generic at the package boundary. A runtime receives a connected session rather than opening raw connections itself. The package can provide helpers for transport-specific concerns, such as websocket runtime differences between browser and Node, without leaking provider-specific client construction into callers.

## Intended Usage

### Product code

Product code should receive or resolve a concrete `AgentRuntime`, construct an `Agent`, connect it, and use the unified operations.

```ts
import { Agent, AgentTransportKinds } from "@mistle/agent";
import { resolveAgentRuntime } from "@mistle/integrations-definitions/agent-runtimes";

const runtime = resolveAgentRuntime({
  familyId: "openai",
  variantId: "openai-default",
  runtimeKey: "codex-app-server",
});

const agent = new Agent({
  runtime,
  sessionConnector,
  transport: {
    kind: AgentTransportKinds.WEBSOCKET,
    url: sandboxAgentUrl,
  },
});

await agent.connect();

const thread = await agent.startThread({
  model: "gpt-5-codex-mini",
});

const turn = await agent.startTurn({
  threadId: thread.threadId,
  input: [{ type: "text", text: "Reply with exactly: ok" }],
});

await agent.close();
```

The important point is that product code does not construct a Codex-specific client or know how the runtime speaks over the sandbox session. It talks to `Agent`.

### Runtime implementation

Integration-owned runtimes implement `AgentRuntime` and build whatever provider-specific client they need on top of the package-owned `AgentSession`.

```ts
import type { AgentRuntime, AgentRuntimeConnectInput, ConnectedAgentRuntime } from "@mistle/agent";

export class OpenAiDefaultAgentRuntime implements AgentRuntime {
  readonly metadata = {
    id: "openai-default",
    displayName: "OpenAI Default",
  };

  async connect(input: AgentRuntimeConnectInput): Promise<ConnectedAgentRuntime> {
    const codexClient = await createCodexClient({
      session: input.session,
    });

    return {
      metadata: this.metadata,
      close: async () => {
        await codexClient.close();
      },
      readThread: async (threadInput) => {
        return await codexClient.readThread(threadInput);
      },
      resumeThread: async (threadInput) => {
        return await codexClient.resumeThread(threadInput);
      },
      startThread: async (threadInput) => {
        return await codexClient.startThread(threadInput);
      },
      startTurn: async (turnInput) => {
        return await codexClient.startTurn(turnInput);
      },
      steerTurn: async (turnInput) => {
        return await codexClient.steerTurn(turnInput);
      },
    };
  }
}
```

The provider-specific client stays behind the runtime implementation. The public caller still only sees `Agent`.

## Design Rules

- Product code talks to `Agent`, not provider-specific clients.
- Integration layers own runtime resolution and runtime implementations.
- `@mistle/agent` owns the sandbox session boundary.
- Provider-specific protocol details stay behind `AgentRuntime`.
- Unified conversation semantics should later build on top of the `Agent` and `AgentRuntime` contracts rather than introducing provider-specific branches in product code.
