import { gzipSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import {
  decodeObservedResponseBody,
  ObservedResponseBodyDecodeError,
} from "./observed-response-body.js";

const MaxDecodedBodyBytes = 1024;

describe("decodeObservedResponseBody", () => {
  it("returns response bodies without content encoding unchanged", async () => {
    const body = encodeJson({ ok: true });

    const decoded = await decodeObservedResponseBody({
      body,
      headers: new Headers({
        "content-type": "application/json",
      }),
      maxDecodedBodyBytes: MaxDecodedBodyBytes,
    });

    expect(decodeText(decoded.body)).toBe('{"ok":true}');
    expect(decoded.contentEncoding).toBeNull();
    expect(decoded.rawBodyBytes).toBe(body.byteLength);
    expect(decoded.decodedBodyBytes).toBe(body.byteLength);
  });

  it("decodes gzip-compressed response bodies before provider observation", async () => {
    const decodedJson = '{"data":{"createPullRequest":true}}';
    const body = new Uint8Array(gzipSync(encodeText(decodedJson)));

    const decoded = await decodeObservedResponseBody({
      body,
      headers: new Headers({
        "content-encoding": "gzip",
        "content-type": "application/json",
      }),
      maxDecodedBodyBytes: MaxDecodedBodyBytes,
    });

    expect(decodeText(decoded.body)).toBe(decodedJson);
    expect(decoded.contentEncoding).toBe("gzip");
    expect(decoded.rawBodyBytes).toBe(body.byteLength);
    expect(decoded.decodedBodyBytes).toBe(encodeText(decodedJson).byteLength);
  });

  it("treats identity content encoding as an unchanged response body", async () => {
    const body = encodeJson({ identity: true });

    const decoded = await decodeObservedResponseBody({
      body,
      headers: new Headers({
        "content-encoding": "identity",
        "content-type": "application/json",
      }),
      maxDecodedBodyBytes: MaxDecodedBodyBytes,
    });

    expect(decodeText(decoded.body)).toBe('{"identity":true}');
    expect(decoded.contentEncoding).toBe("identity");
    expect(decoded.rawBodyBytes).toBe(body.byteLength);
    expect(decoded.decodedBodyBytes).toBe(body.byteLength);
  });

  it("fails explicitly when a response advertises gzip but contains invalid gzip bytes", async () => {
    await expect(
      decodeObservedResponseBody({
        body: encodeText("not gzip"),
        headers: new Headers({
          "content-encoding": "gzip",
          "content-type": "application/json",
        }),
        maxDecodedBodyBytes: MaxDecodedBodyBytes,
      }),
    ).rejects.toThrow(ObservedResponseBodyDecodeError);
  });
});

function encodeJson(value: unknown): Uint8Array {
  return encodeText(JSON.stringify(value));
}

function encodeText(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function decodeText(value: Uint8Array): string {
  return new TextDecoder().decode(value);
}
