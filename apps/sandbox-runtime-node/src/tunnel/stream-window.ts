import { MaxStreamWindowBytes } from "@mistle/sandbox-session-protocol";

export class StreamSendWindow {
  #availableBytes: number;

  constructor(initialBytes = MaxStreamWindowBytes) {
    this.#availableBytes = initialBytes;
  }

  add(bytes: number): void {
    if (!Number.isInteger(bytes) || bytes <= 0) {
      throw new Error("stream.window bytes must be a positive integer");
    }

    if (this.#availableBytes > MaxStreamWindowBytes - bytes) {
      throw new Error(
        `stream.window credit exceeds configured maximum of ${String(MaxStreamWindowBytes)} bytes`,
      );
    }

    this.#availableBytes += bytes;
  }

  tryConsume(bytes: number): boolean {
    if (!Number.isInteger(bytes) || bytes < 0) {
      return false;
    }

    if (bytes > this.#availableBytes) {
      return false;
    }

    this.#availableBytes -= bytes;
    return true;
  }
}
