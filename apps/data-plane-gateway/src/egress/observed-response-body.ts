import { promisify } from "node:util";
import { brotliDecompress, gunzip, inflate } from "node:zlib";

const gunzipAsync = promisify(gunzip);
const inflateAsync = promisify(inflate);
const brotliDecompressAsync = promisify(brotliDecompress);

export type DecodedObservedResponseBody = {
  body: Uint8Array;
  contentEncoding: string | null;
  decodedBodyBytes: number;
  rawBodyBytes: number;
};

export class ObservedResponseBodyDecodeError extends Error {
  public constructor(
    message: string,
    public readonly contentEncoding: string,
  ) {
    super(message);
    this.name = "ObservedResponseBodyDecodeError";
  }
}

export async function decodeObservedResponseBody(input: {
  body: Uint8Array;
  headers: Headers;
  maxDecodedBodyBytes: number;
}): Promise<DecodedObservedResponseBody> {
  const contentEncoding = input.headers.get("content-encoding");
  if (contentEncoding === null || contentEncoding.trim().length === 0) {
    assertDecodedBodyWithinLimit({
      body: input.body,
      maxDecodedBodyBytes: input.maxDecodedBodyBytes,
    });
    return {
      body: input.body,
      contentEncoding,
      decodedBodyBytes: input.body.byteLength,
      rawBodyBytes: input.body.byteLength,
    };
  }

  let decodedBody = input.body;
  const encodings = contentEncoding
    .split(",")
    .map((encoding) => encoding.trim().toLowerCase())
    .filter((encoding) => encoding.length > 0);

  for (const encoding of encodings.toReversed()) {
    decodedBody = await decodeOneContentEncoding({
      body: decodedBody,
      contentEncoding,
      encoding,
      maxDecodedBodyBytes: input.maxDecodedBodyBytes,
    });
  }
  assertDecodedBodyWithinLimit({
    body: decodedBody,
    maxDecodedBodyBytes: input.maxDecodedBodyBytes,
  });

  return {
    body: decodedBody,
    contentEncoding,
    decodedBodyBytes: decodedBody.byteLength,
    rawBodyBytes: input.body.byteLength,
  };
}

async function decodeOneContentEncoding(input: {
  body: Uint8Array;
  contentEncoding: string;
  encoding: string;
  maxDecodedBodyBytes: number;
}): Promise<Uint8Array> {
  try {
    if (input.encoding === "identity") {
      return input.body;
    }

    if (input.encoding === "gzip" || input.encoding === "x-gzip") {
      return await gunzipAsync(input.body, {
        maxOutputLength: input.maxDecodedBodyBytes,
      });
    }

    if (input.encoding === "deflate") {
      return await inflateAsync(input.body, {
        maxOutputLength: input.maxDecodedBodyBytes,
      });
    }

    if (input.encoding === "br") {
      return await brotliDecompressAsync(input.body, {
        maxOutputLength: input.maxDecodedBodyBytes,
      });
    }
  } catch (error) {
    throw new ObservedResponseBodyDecodeError(
      `Failed to decode observed response body with content-encoding '${input.contentEncoding}': ${
        error instanceof Error ? error.message : String(error)
      }`,
      input.contentEncoding,
    );
  }

  throw new ObservedResponseBodyDecodeError(
    `Unsupported observed response body content-encoding '${input.contentEncoding}'.`,
    input.contentEncoding,
  );
}

function assertDecodedBodyWithinLimit(input: {
  body: Uint8Array;
  maxDecodedBodyBytes: number;
}): void {
  if (input.body.byteLength <= input.maxDecodedBodyBytes) {
    return;
  }

  throw new ObservedResponseBodyDecodeError(
    `Observed response body decoded to ${String(input.body.byteLength)} bytes, which exceeds the ${String(
      input.maxDecodedBodyBytes,
    )} byte limit.`,
    "identity",
  );
}
