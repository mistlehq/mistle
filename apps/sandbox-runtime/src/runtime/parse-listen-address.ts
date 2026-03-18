export type ParsedListenAddress = {
  host?: string;
  port: number;
};

export function parseListenAddress(listenAddr: string): ParsedListenAddress {
  if (listenAddr.startsWith(":")) {
    const port = Number.parseInt(listenAddr.slice(1), 10);
    if (!Number.isInteger(port) || port < 0 || port > 65_535) {
      throw new Error(`invalid listen addr ${listenAddr}`);
    }

    return { port };
  }

  const separatorIndex = listenAddr.lastIndexOf(":");
  if (separatorIndex < 1 || separatorIndex === listenAddr.length - 1) {
    throw new Error(`invalid listen addr ${listenAddr}`);
  }

  const host = listenAddr.slice(0, separatorIndex);
  const port = Number.parseInt(listenAddr.slice(separatorIndex + 1), 10);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error(`invalid listen addr ${listenAddr}`);
  }

  return {
    host,
    port,
  };
}
