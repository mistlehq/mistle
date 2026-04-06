/**
 * Sandbox-local process and endpoint keys for the Codex app-server runtime.
 *
 * The raw app-server listens on an internal websocket port, while clients talk
 * to the sandboxd-managed proxy endpoint on the public runtime port.
 */
export const CodexAppServerProcessKey = "codex-app-server";
export const CodexAppServerEndpointKey = "app-server";
export const CodexProxyListenUrl = "ws://127.0.0.1:4500";
export const CodexAppServerListenUrl = "ws://127.0.0.1:4501";
