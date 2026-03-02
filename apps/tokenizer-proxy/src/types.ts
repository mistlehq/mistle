import type { ServerType } from "@hono/node-server";
import { AppIds, type loadConfig } from "@mistle/config";
import type { Context, Hono } from "hono";

type LoadTokenizerProxyConfigResult = ReturnType<typeof loadConfig<typeof AppIds.TOKENIZER_PROXY>>;

export type TokenizerProxyConfig = LoadTokenizerProxyConfigResult["app"];
export type TokenizerProxyGlobalConfig = NonNullable<LoadTokenizerProxyConfigResult["global"]>;

export type TokenizerProxyRuntimeConfig = {
  app: TokenizerProxyConfig;
  internalAuthServiceToken: TokenizerProxyGlobalConfig["internalAuth"]["serviceToken"];
};

export type AppContextBindings = {
  Variables: AppContextVariables;
};

export type AppContextVariables = {
  config: TokenizerProxyConfig;
  internalAuthServiceToken: string;
};

export type AppContext = Context<AppContextBindings>;
export type TokenizerProxyApp = Hono<AppContextBindings>;

export type StartServerInput = {
  app: TokenizerProxyApp;
  host: string;
  port: number;
};

export type StartedServer = {
  server: ServerType;
  close: () => Promise<void>;
};

export type TokenizerProxyRuntime = {
  app: TokenizerProxyApp;
  request: (path: string, init?: RequestInit) => Promise<Response>;
  start: () => Promise<void>;
  stop: () => Promise<void>;
};
