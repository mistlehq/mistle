import { Hono } from "hono";

import type { AppContextBindings, TokenizerProxyApp, TokenizerProxyConfig } from "./types.js";

const EgressRoutePath = "/tokenizer-proxy/egress/routes/:routeId/*";

type CreateNotImplementedResponseInput = {
  message: string;
};

function createNotImplementedResponse(input: CreateNotImplementedResponseInput) {
  return {
    code: "NOT_IMPLEMENTED",
    message: input.message,
  } as const;
}

export function createApp(
  config: TokenizerProxyConfig,
  internalAuthServiceToken: string,
): TokenizerProxyApp {
  const app = new Hono<AppContextBindings>();

  app.use("*", async (ctx, next) => {
    ctx.set("config", config);
    ctx.set("internalAuthServiceToken", internalAuthServiceToken);
    await next();
  });

  app.get("/__healthz", (ctx) => {
    return ctx.json({ ok: true });
  });

  app.all(EgressRoutePath, (ctx) => {
    const routeId = ctx.req.param("routeId");

    return ctx.json(
      createNotImplementedResponse({
        message: `Tokenizer proxy egress route '${routeId}' is not implemented.`,
      }),
      501,
    );
  });

  return app;
}
