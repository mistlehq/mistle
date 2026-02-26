import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import {
  convertDotenvContentToTomlContent,
  convertTomlContentToDotenvContent,
} from "../../packages/config/src/conversion.ts";

type ConvertMode = "env-to-toml" | "toml-to-env";

type ParsedCliArguments = {
  mode: ConvertMode;
  inputPath: string;
  outputPath: string;
};

function parseMode(rawMode: string | undefined): ConvertMode {
  if (rawMode === "env-to-toml") {
    return rawMode;
  }

  if (rawMode === "toml-to-env") {
    return rawMode;
  }

  throw new Error("Missing or invalid mode. Expected 'env-to-toml' or 'toml-to-env'.");
}

function parseOptionValue(
  options: Record<string, string | undefined>,
  optionName: "--input" | "--output",
): string {
  const value = options[optionName];
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`Missing required option: ${optionName}`);
  }

  return value;
}

function parseCliArguments(argv: readonly string[]): ParsedCliArguments {
  if (argv.length === 0) {
    throw new Error("Usage: <env-to-toml|toml-to-env> --input <path> --output <path>");
  }

  const mode = parseMode(argv[0]);
  const options: Record<string, string | undefined> = {};

  let index = 1;
  while (index < argv.length) {
    const optionToken = argv[index];
    if (optionToken === "--") {
      index += 1;
      continue;
    }

    const optionName = optionToken;
    const optionValue = argv[index + 1];

    if (optionName !== "--input" && optionName !== "--output") {
      throw new Error(`Unknown option: ${optionName ?? "<missing>"}`);
    }

    if (optionValue === undefined) {
      throw new Error(`Missing value for option: ${optionName}`);
    }

    options[optionName] = optionValue;
    index += 2;
  }

  return {
    mode,
    inputPath: resolve(parseOptionValue(options, "--input")),
    outputPath: resolve(parseOptionValue(options, "--output")),
  };
}

function normalizeOutputContent(content: string): string {
  if (content.length === 0 || content.endsWith("\n")) {
    return content;
  }

  return `${content}\n`;
}

function runConversion(input: ParsedCliArguments): void {
  const sourceContent = readFileSync(input.inputPath, "utf8");

  const convertedContent =
    input.mode === "env-to-toml"
      ? convertDotenvContentToTomlContent(sourceContent)
      : convertTomlContentToDotenvContent(sourceContent);

  mkdirSync(dirname(input.outputPath), { recursive: true });
  writeFileSync(input.outputPath, normalizeOutputContent(convertedContent), "utf8");
}

function main(): void {
  const parsed = parseCliArguments(process.argv.slice(2));
  runConversion(parsed);
}

try {
  main();
} catch (error) {
  if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error(String(error));
  }

  process.exitCode = 1;
}
