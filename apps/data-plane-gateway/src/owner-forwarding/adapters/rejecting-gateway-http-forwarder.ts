import type { GatewayHttpForwarder, GatewayHttpForwardRequest } from "../types.js";

type RejectingGatewayHttpForwarderInput = {
  reason: string;
};

export class RejectingGatewayHttpForwarder implements GatewayHttpForwarder {
  public constructor(private readonly reason: string) {}

  public static create(input: RejectingGatewayHttpForwarderInput): RejectingGatewayHttpForwarder {
    return new RejectingGatewayHttpForwarder(input.reason);
  }

  public async forwardRequest(_input: GatewayHttpForwardRequest): Promise<Response> {
    return new Response(
      JSON.stringify({
        error: this.reason,
      }),
      {
        status: 501,
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
      },
    );
  }
}
