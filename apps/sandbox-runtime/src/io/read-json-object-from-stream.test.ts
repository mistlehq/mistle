import { PassThrough, Readable } from "node:stream";

import { describe, expect, it } from "vitest";

import { readJsonObjectFromStream } from "./read-json-object-from-stream.js";

function createReader(input: string): Readable {
  return Readable.from([input]);
}

describe("readJsonObjectFromStream", () => {
  it("reads the first complete top-level object without waiting for eof", async () => {
    const reader = new PassThrough();
    const readPromise = readJsonObjectFromStream({
      reader,
      maxBytes: 1024,
      label: "test json object",
    });

    reader.write('{"token":"abc","nested":{"value":1}}');

    await expect(readPromise).resolves.toBe('{"token":"abc","nested":{"value":1}}');

    expect(reader.destroyed).toBe(false);
    reader.destroy();
  });

  it("keeps brace characters inside strings from ending the object early", async () => {
    await expect(
      readJsonObjectFromStream({
        reader: createReader('{"message":"{still-json}","escaped":"quote: \\""}'),
        maxBytes: 1024,
        label: "test json object",
      }),
    ).resolves.toBe('{"message":"{still-json}","escaped":"quote: \\""}');
  });

  it("rejects trailing content after the first object", async () => {
    await expect(
      readJsonObjectFromStream({
        reader: createReader('{"token":"abc"} {"unexpected":true}'),
        maxBytes: 1024,
        label: "test json object",
      }),
    ).rejects.toThrow("test json object must be valid json: unexpected trailing JSON content");
  });

  it("rejects input that exceeds the byte limit", async () => {
    await expect(
      readJsonObjectFromStream({
        reader: createReader('{"token":"abc"}'),
        maxBytes: 4,
        label: "test json object",
      }),
    ).rejects.toThrow("test json object exceeds max size of 4 bytes");
  });

  it("rejects empty streams", async () => {
    await expect(
      readJsonObjectFromStream({
        reader: createReader(" \n\t "),
        maxBytes: 1024,
        label: "test json object",
      }),
    ).rejects.toThrow("test json object is empty");
  });
});
