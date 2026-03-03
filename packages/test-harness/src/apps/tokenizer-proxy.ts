import type { StartDockerHttpAppInput, DockerHttpAppDefinition } from "./http-app.js";
import { startDockerHttpApp } from "./http-app.js";
import type { StartedWorkspaceApp } from "./shared.js";

const TokenizerProxyDefinition: DockerHttpAppDefinition = {
  appName: "tokenizer-proxy",
  distEntrypointRelativePath: "apps/tokenizer-proxy/dist/index.js",
  dockerfileRelativePath: "Dockerfile.test",
  dockerTarget: "tokenizer-proxy-test-runtime",
  containerPort: 5205,
  networkAlias: "tokenizer-proxy",
  healthPath: "/__healthz",
  hostEnvVar: "MISTLE_APPS_TOKENIZER_PROXY_HOST",
  portEnvVar: "MISTLE_APPS_TOKENIZER_PROXY_PORT",
};

export type StartTokenizerProxyInput = StartDockerHttpAppInput;
export type TokenizerProxyService = StartedWorkspaceApp;

export async function startTokenizerProxy(
  input: StartTokenizerProxyInput,
): Promise<TokenizerProxyService> {
  return startDockerHttpApp(TokenizerProxyDefinition, input);
}
