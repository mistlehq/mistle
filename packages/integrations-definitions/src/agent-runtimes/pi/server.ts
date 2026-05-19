/**
 * Sandbox-local process and endpoint keys for the Pi runtime.
 *
 * Pi RPC is a JSONL stdio protocol. The sandboxd-managed Pi proxy owns the Pi
 * process and exposes the same websocket agent endpoint shape used by other
 * managed runtimes.
 */
export const PiRuntimeClientId = "pi-cli";
export const PiRuntimeProcessKey = "pi-rpc";
export const PiRuntimeEndpointKey = "rpc";
export const PiProxyListenUrl = "ws://127.0.0.1:4520";
