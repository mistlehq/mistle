import type {
  AgentReadThreadInput,
  AgentResumeThreadInput,
  AgentRuntime,
  AgentRuntimeConnectInput,
  AgentStartThreadInput,
  AgentStartTurnInput,
  AgentSteerTurnInput,
  ConnectedAgentRuntime,
} from "./types.js";

export type AgentInput = AgentRuntimeConnectInput & {
  runtime: AgentRuntime;
};

export class Agent {
  readonly #runtime: AgentRuntime;
  readonly #transport: AgentRuntimeConnectInput["transport"];

  #connectedRuntime: ConnectedAgentRuntime | null = null;

  constructor(input: AgentInput) {
    this.#runtime = input.runtime;
    this.#transport = input.transport;
  }

  get runtime(): AgentRuntime["info"] {
    return this.#runtime.info;
  }

  get isConnected(): boolean {
    return this.#connectedRuntime !== null;
  }

  async connect(): Promise<void> {
    if (this.#connectedRuntime !== null) {
      throw new Error("Agent is already connected.");
    }

    this.#connectedRuntime = await this.#runtime.connect({
      transport: this.#transport,
    });
  }

  async close(): Promise<void> {
    const connectedRuntime = this.#connectedRuntime;
    this.#connectedRuntime = null;
    if (connectedRuntime === null) {
      return;
    }

    await connectedRuntime.close();
  }

  async readThread(input: AgentReadThreadInput) {
    return await this.#getConnectedRuntime().readThread(input);
  }

  async resumeThread(input: AgentResumeThreadInput) {
    return await this.#getConnectedRuntime().resumeThread(input);
  }

  async startThread(input: AgentStartThreadInput) {
    return await this.#getConnectedRuntime().startThread(input);
  }

  async startTurn(input: AgentStartTurnInput) {
    return await this.#getConnectedRuntime().startTurn(input);
  }

  async steerTurn(input: AgentSteerTurnInput) {
    return await this.#getConnectedRuntime().steerTurn(input);
  }

  #getConnectedRuntime(): ConnectedAgentRuntime {
    const connectedRuntime = this.#connectedRuntime;
    if (connectedRuntime === null) {
      throw new Error("Agent is not connected.");
    }

    return connectedRuntime;
  }
}
