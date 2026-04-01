import { MaxStreamWindowBytes } from "@mistle/sandbox-session-protocol";

import { StreamSendWindow } from "./stream-window.js";

export type EnqueueTelemetryLogLineResult =
  | {
      kind: "accepted";
    }
  | {
      kind: "dropped";
      droppedBytes: number;
      emitWarning: boolean;
    };

export class TelemetryLogBuffer {
  readonly #bufferedLines: Uint8Array[] = [];
  #bufferedBytes = 0;
  #dropWarningEmitted = false;
  #sendWindow = new StreamSendWindow(0);

  public constructor(private readonly maxBufferedBytes: number = MaxStreamWindowBytes) {}

  public resetWindow(initialWindowBytes: number): void {
    this.#sendWindow = new StreamSendWindow(initialWindowBytes);
  }

  public addWindow(bytes: number): void {
    this.#sendWindow.add(bytes);
  }

  public enqueue(line: Uint8Array): EnqueueTelemetryLogLineResult {
    if (line.byteLength > this.maxBufferedBytes) {
      return this.#dropLine(line.byteLength);
    }
    if (this.#bufferedBytes + line.byteLength > this.maxBufferedBytes) {
      return this.#dropLine(line.byteLength);
    }

    this.#bufferedLines.push(line);
    this.#bufferedBytes += line.byteLength;
    return {
      kind: "accepted",
    };
  }

  public drainSendableLines(): Uint8Array[] {
    const sendableLines: Uint8Array[] = [];

    while (this.#bufferedLines.length > 0) {
      const nextLine = this.#bufferedLines[0];
      if (nextLine === undefined) {
        break;
      }
      if (!this.#sendWindow.tryConsume(nextLine.byteLength)) {
        break;
      }

      this.#bufferedLines.shift();
      this.#bufferedBytes -= nextLine.byteLength;
      this.#dropWarningEmitted = false;
      sendableLines.push(nextLine);
    }

    return sendableLines;
  }

  public clear(): void {
    this.#bufferedLines.length = 0;
    this.#bufferedBytes = 0;
    this.#dropWarningEmitted = false;
    this.#sendWindow = new StreamSendWindow(0);
  }

  public get bufferedLineCount(): number {
    return this.#bufferedLines.length;
  }

  #dropLine(droppedBytes: number): EnqueueTelemetryLogLineResult {
    const emitWarning = !this.#dropWarningEmitted;
    this.#dropWarningEmitted = true;
    return {
      kind: "dropped",
      droppedBytes,
      emitWarning,
    };
  }
}
