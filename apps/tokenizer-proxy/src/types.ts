import type { IncomingMessage } from "node:http";
import type { Socket } from "node:net";

import type { ServerType } from "@hono/node-server";
import { AppIds, type loadConfig } from "@mistle/config";
import type { Context, Hono } from "hono";

type LoadTokenizerProxyConfigResult = ReturnType<typeof loadConfig<typeof AppIds.TOKENIZER_PROXY>>;

export type TokenizerProxyTestIsolationConfig = {
  testEnvironmentIdHeader: string;
};

export type TokenizerProxyConfig = LoadTokenizerProxyConfigResult["app"] & {
  __dangerouslyEnableTestIsolation?: TokenizerProxyTestIsolationConfig;
};

export type TokenizerProxyRuntimeConfig = {
  app: TokenizerProxyConfig;
};

export type AppContextBindings = {
  Variables: AppContextVariables;
};

export type AppContextVariables = {
  config: TokenizerProxyConfig;
  internalAuthServiceToken: string;
  testEnvironmentId?: string;
};

export type AppContext = Context<AppContextBindings>;
export type TokenizerProxyApp = Hono<AppContextBindings>;
export type TokenizerProxyUpgradeHandler = (
  request: IncomingMessage,
  socket: Socket,
  head: Buffer,
) => void;

export type StartServerInput = {
  app: TokenizerProxyApp;
  host: string;
  port: number;
  onUpgrade?: TokenizerProxyUpgradeHandler;
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
