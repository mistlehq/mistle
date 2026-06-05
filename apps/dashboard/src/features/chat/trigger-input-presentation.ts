export type StructuredTriggerInputSegment =
  | {
      kind: "json";
      text: string;
    }
  | {
      kind: "text";
      text: string;
    };

export type StructuredTriggerInputPresentation = {
  inlineSegments: readonly StructuredTriggerInputSegment[];
};

type JsonObjectSpan = {
  endIndex: number;
  text: string;
  startIndex: number;
};

export function presentTriggerInput(text: string): StructuredTriggerInputPresentation | null {
  const jsonSpans = findJsonObjectSpans(text);
  if (jsonSpans.length === 0) {
    return null;
  }

  return {
    inlineSegments: createJsonInlineSegments(text, jsonSpans),
  };
}

function findJsonObjectSpans(text: string): readonly JsonObjectSpan[] {
  const jsonObjectSpans: JsonObjectSpan[] = [];
  const openBraceIndexes: number[] = [];
  let openCodeFence: MarkdownCodeFence | null = null;
  let insideString = false;
  let escaped = false;
  let lineStartIndex = 0;

  for (let index = 0; index < text.length; index += 1) {
    if (openBraceIndexes.length === 0 && index === lineStartIndex) {
      const fence = readMarkdownCodeFence(text, lineStartIndex);
      if (fence !== null) {
        if (
          openCodeFence !== null &&
          fence.marker === openCodeFence.marker &&
          fence.length >= openCodeFence.length &&
          fence.hasOnlyWhitespaceSuffix
        ) {
          openCodeFence = null;
        } else if (openCodeFence === null) {
          openCodeFence = fence;
        }
      }
    }

    const character = text[index];
    if (openBraceIndexes.length > 0 && insideString) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        insideString = false;
      }
    } else if (openBraceIndexes.length > 0 && character === '"') {
      insideString = true;
    } else if (openCodeFence === null && character === "{") {
      openBraceIndexes.push(index);
    } else if (openBraceIndexes.length > 0 && character === "}") {
      const startIndex = openBraceIndexes.pop();
      if (startIndex !== undefined) {
        const endIndex = index + 1;
        if (openBraceIndexes.length === 0) {
          const parsedSpan = parseJsonObjectSpan(text, startIndex, endIndex);
          if (parsedSpan !== null) {
            jsonObjectSpans.push(parsedSpan);
          }

          insideString = false;
          escaped = false;
        }
      }
    }

    if (character === "\n") {
      lineStartIndex = index + 1;
    }
  }

  return jsonObjectSpans;
}

type MarkdownCodeFence = {
  hasOnlyWhitespaceSuffix: boolean;
  length: number;
  marker: "`" | "~";
};

function readMarkdownCodeFence(text: string, lineStartIndex: number): MarkdownCodeFence | null {
  let index = lineStartIndex;
  while (index < text.length && (text[index] === " " || text[index] === "\t")) {
    index += 1;
  }

  const marker = text[index];
  if (marker !== "`" && marker !== "~") {
    return null;
  }

  let length = 0;
  while (text[index + length] === marker) {
    length += 1;
  }

  if (length < 3) {
    return null;
  }

  return {
    hasOnlyWhitespaceSuffix: hasOnlyWhitespaceLineSuffix(text, index + length),
    length,
    marker,
  };
}

function hasOnlyWhitespaceLineSuffix(text: string, startIndex: number): boolean {
  for (let index = startIndex; index < text.length; index += 1) {
    const character = text[index];
    if (character === "\n") {
      return true;
    }
    if (character !== " " && character !== "\t" && character !== "\r") {
      return false;
    }
  }

  return true;
}

function parseJsonObjectSpan(
  text: string,
  startIndex: number,
  endIndex: number,
): JsonObjectSpan | null {
  const prefixText = text.slice(0, startIndex);
  const suffixText = text.slice(endIndex);
  if (prefixText.trimEnd().endsWith("[") || suffixText.trimStart().startsWith("]")) {
    return null;
  }

  const jsonText = text.slice(startIndex, endIndex);
  return isStrictJsonObjectText(jsonText) ? { endIndex, startIndex, text: jsonText } : null;
}

function isStrictJsonObjectText(text: string): boolean {
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed);
  } catch {
    return false;
  }
}

function createJsonInlineSegments(
  text: string,
  jsonSpans: readonly JsonObjectSpan[],
): readonly StructuredTriggerInputSegment[] {
  const segments: StructuredTriggerInputSegment[] = [];
  let currentIndex = 0;

  for (const span of jsonSpans) {
    const inlineText = trimJsonBoundaryText(text.slice(currentIndex, span.startIndex));
    if (inlineText !== null) {
      segments.push({ kind: "text", text: inlineText });
    }
    segments.push({ kind: "json", text: formatJsonText(span.text) });
    currentIndex = span.endIndex;
  }

  const inlineSuffixText = trimJsonBoundaryText(text.slice(currentIndex));
  if (inlineSuffixText !== null) {
    segments.push({ kind: "text", text: inlineSuffixText });
  }

  return segments;
}

function trimJsonBoundaryText(text: string): string | null {
  const trimmedText = text.trim();
  return trimmedText.length === 0 ? null : trimmedText;
}

function formatJsonText(text: string): string {
  let formattedText = "";
  let indentDepth = 0;
  let insideString = false;
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];

    if (insideString) {
      formattedText += character;
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        insideString = false;
      }
      continue;
    }

    if (character === '"') {
      insideString = true;
      formattedText += character;
    } else if (character === "{" || character === "[") {
      formattedText += character;
      indentDepth += 1;
      if (!isNextNonWhitespaceCharacter(text, index + 1, character === "{" ? "}" : "]")) {
        formattedText += `\n${createJsonIndent(indentDepth)}`;
      }
    } else if (character === "}" || character === "]") {
      indentDepth -= 1;
      if (!doesFormattedTextEndWithOpeningBracket(formattedText)) {
        formattedText += `\n${createJsonIndent(indentDepth)}`;
      }
      formattedText += character;
    } else if (character === ",") {
      formattedText += `,\n${createJsonIndent(indentDepth)}`;
    } else if (character === ":") {
      formattedText += ": ";
    } else if (
      character !== " " &&
      character !== "\n" &&
      character !== "\r" &&
      character !== "\t"
    ) {
      formattedText += character;
    }
  }

  return formattedText;
}

function isNextNonWhitespaceCharacter(
  text: string,
  startIndex: number,
  expectedCharacter: string,
): boolean {
  for (let index = startIndex; index < text.length; index += 1) {
    const character = text[index];
    if (character === " " || character === "\n" || character === "\r" || character === "\t") {
      continue;
    }

    return character === expectedCharacter;
  }

  return false;
}

function doesFormattedTextEndWithOpeningBracket(text: string): boolean {
  return text.endsWith("{") || text.endsWith("[");
}

function createJsonIndent(depth: number): string {
  return "  ".repeat(Math.max(0, depth));
}
