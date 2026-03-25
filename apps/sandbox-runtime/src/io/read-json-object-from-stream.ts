import { type Readable } from "node:stream";
import { StringDecoder } from "node:string_decoder";

type ReadJsonObjectFromStreamInput = {
  reader: Readable;
  maxBytes: number;
  label: string;
};

type JsonScanState = {
  started: boolean;
  depth: number;
  inString: boolean;
  escaped: boolean;
};

// This is intentionally a lightweight stream boundary detector, not a JSON validator.
// We need to stop once the first complete top-level object arrives on the stream without
// waiting for EOF or repeatedly using JSON.parse() exceptions as incremental control flow.
function updateJsonScanState(state: JsonScanState, value: string): number | undefined {
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === undefined) {
      continue;
    }

    if (!state.started) {
      if (/\s/u.test(character)) {
        continue;
      }

      if (character !== "{") {
        return undefined;
      }

      state.started = true;
      state.depth = 1;
      continue;
    }

    if (state.inString) {
      if (state.escaped) {
        state.escaped = false;
        continue;
      }

      if (character === "\\") {
        state.escaped = true;
        continue;
      }

      if (character === '"') {
        state.inString = false;
      }

      continue;
    }

    if (character === '"') {
      state.inString = true;
      continue;
    }

    if (character === "{") {
      state.depth += 1;
      continue;
    }

    if (character === "}") {
      state.depth -= 1;
      if (state.depth === 0) {
        return index + 1;
      }
    }
  }

  return undefined;
}

export async function readJsonObjectFromStream(
  input: ReadJsonObjectFromStreamInput,
): Promise<string> {
  const decoder = new StringDecoder("utf8");
  let rawJson = "";
  let totalBytes = 0;
  const scanState: JsonScanState = {
    started: false,
    depth: 0,
    inString: false,
    escaped: false,
  };

  for await (const chunk of input.reader.iterator({ destroyOnReturn: false })) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.length;

    if (totalBytes > input.maxBytes) {
      throw new Error(`${input.label} exceeds max size of ${input.maxBytes} bytes`);
    }

    const decodedChunk = decoder.write(buffer);
    rawJson += decodedChunk;
    const completeObjectEndInChunk = updateJsonScanState(scanState, decodedChunk);
    if (completeObjectEndInChunk === undefined) {
      continue;
    }

    const completeObjectEnd = rawJson.length - decodedChunk.length + completeObjectEndInChunk;
    const completeJson = rawJson.slice(0, completeObjectEnd);
    const trailingContent = rawJson.slice(completeObjectEnd);
    if (trailingContent.trim().length > 0) {
      throw new Error(`${input.label} must be valid json: unexpected trailing JSON content`);
    }

    return completeJson;
  }

  rawJson += decoder.end();
  if (rawJson.trim().length === 0) {
    throw new Error(`${input.label} is empty`);
  }

  return rawJson;
}
