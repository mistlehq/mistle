import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { parseArgs } from "./extract-designer-transcript.js";

describe("parseArgs", () => {
  it("requires a Docker container id or name", () => {
    expect(() => parseArgs([])).toThrow("Missing required --container <id-or-name>.");
  });

  it("parses the container, thread, and output directory", () => {
    expect(
      parseArgs([
        "--",
        "--container",
        "designer-runtime",
        "--thread",
        "019f25b6-9f25-7d10-beb4-967a1a72c499",
        "--out",
        ".local/custom-transcript",
      ]),
    ).toEqual({
      container: "designer-runtime",
      outDir: resolve(process.cwd(), ".local/custom-transcript"),
      threadId: "019f25b6-9f25-7d10-beb4-967a1a72c499",
    });
  });

  it("rejects unsupported arguments", () => {
    expect(() => parseArgs(["--container", "designer-runtime", "--summary"])).toThrow(
      "Unsupported argument: --summary",
    );
  });
});
