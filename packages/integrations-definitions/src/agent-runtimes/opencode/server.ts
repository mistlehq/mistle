/**
 * Sandbox-local process and endpoint keys for the OpenCode server runtime.
 *
 * The raw OpenCode HTTP server listens on an internal port. Clients talk to the
 * sandboxd-managed runtime proxy endpoint, which will translate the Mistle
 * websocket runtime protocol to OpenCode server requests.
 */
export const OpenCodeServerProcessKey = "opencode-server";
export const OpenCodeServerEndpointKey = "server";
export const OpenCodeProxyListenUrl = "ws://127.0.0.1:4510";
export const OpenCodeServerListenHost = "127.0.0.1";
export const OpenCodeServerListenPort = 4511;
export const OpenCodeServerListenUrl = `http://${OpenCodeServerListenHost}:${OpenCodeServerListenPort}`;
export const OpenCodeServerHealthUrl = `${OpenCodeServerListenUrl}/global/health`;
