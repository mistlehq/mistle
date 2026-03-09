import type {
  AgentReadThreadInput,
  AgentResumeThreadInput,
  AgentRuntime,
  AgentSession,
  AgentSessionConnector,
  AgentStartThreadInput,
  AgentStartTurnInput,
  AgentSteerTurnInput,
  ConnectedAgentRuntime,
} from "./types.js";

export type AgentInput = {
  runtime: AgentRuntime;
  sessionConnector: AgentSessionConnector;
  transport: AgentSession["transport"];
};

export class Agent {
  readonly #runtime: AgentRuntime;
  readonly #sessionConnector: AgentSessionConnector;
  readonly #transport: AgentSession["transport"];

  #connectedRuntime: ConnectedAgentRuntime | null = null;

  constructor(input: AgentInput) {
    this.#runtime = input.runtime;
    this.#sessionConnector = input.sessionConnector;
    this.#transport = input.transport;
  }

  get runtime(): AgentRuntime["metadata"] {
    return this.#runtime.metadata;
  }

  get isConnected(): boolean {
    return this.#connectedRuntime !== null;
  }

  async connect(): Promise<void> {
    if (this.#connectedRuntime !== null) {
      throw new Error("Agent is already connected.");
    }

    const session = await this.#sessionConnector.connect({
      transport: this.#transport,
    });

    try {
      this.#connectedRuntime = await this.#runtime.connect({
        session,
      });
    } catch (error) {
      await session.close();
      throw error;
    }
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
