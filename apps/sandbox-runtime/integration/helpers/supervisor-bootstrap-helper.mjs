import { writeFile } from "node:fs/promises";

const outputPath = process.env.MISTLE_SUPERVISOR_HELPER_OUTPUT_PATH;

if (typeof outputPath !== "string" || outputPath.length === 0) {
  throw new Error("supervisor helper output path is required");
}

let stdinData = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  stdinData += chunk;
});
process.stdin.on("end", () => {
  void writeFile(outputPath, stdinData, "utf8").then(() => {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
  });
});
