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

const MaxNestedFallbackSpans = 32;

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
  const nestedFallbackSpans: { endIndex: number; startIndex: number }[] = [];
  let insideCodeFence = false;
  let codeFenceMarker: "`" | "~" | null = null;
  let insideString = false;
  let escaped = false;
  let lineStartIndex = 0;

  for (let index = 0; index < text.length; index += 1) {
    if (openBraceIndexes.length === 0 && index === lineStartIndex) {
      const fence = readMarkdownCodeFence(text, lineStartIndex);
      if (fence !== null) {
        if (insideCodeFence && fence.marker === codeFenceMarker) {
          insideCodeFence = false;
          codeFenceMarker = null;
        } else if (!insideCodeFence) {
          insideCodeFence = true;
          codeFenceMarker = fence.marker;
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
    } else if (!insideCodeFence && character === "{") {
      openBraceIndexes.push(index);
    } else if (openBraceIndexes.length > 0 && character === "}") {
      const startIndex = openBraceIndexes.pop();
      if (startIndex !== undefined) {
        const endIndex = index + 1;
        if (openBraceIndexes.length === 0) {
          const parsedSpan = parseJsonObjectSpan(text, startIndex, endIndex);
          if (parsedSpan !== null) {
            jsonObjectSpans.push(parsedSpan);
          } else {
            const nestedSpan = findFirstParsedNestedSpan(text, nestedFallbackSpans);
            if (nestedSpan !== null) {
              jsonObjectSpans.push(nestedSpan);
            }
          }

          nestedFallbackSpans.length = 0;
          insideString = false;
          escaped = false;
        } else if (
          nestedFallbackSpans.length < MaxNestedFallbackSpans &&
          isLikelyJsonObjectStart(text, startIndex)
        ) {
          nestedFallbackSpans.push({ endIndex, startIndex });
        }
      }
    }

    if (character === "\n") {
      lineStartIndex = index + 1;
    }
  }

  const nestedSpan = findFirstParsedNestedSpan(text, nestedFallbackSpans);
  if (nestedSpan !== null) {
    jsonObjectSpans.push(nestedSpan);
  }

  return jsonObjectSpans;
}

function readMarkdownCodeFence(text: string, lineStartIndex: number): { marker: "`" | "~" } | null {
  let index = lineStartIndex;
  while (index < text.length && (text[index] === " " || text[index] === "\t")) {
    index += 1;
  }

  const marker = text[index];
  if (marker !== "`" && marker !== "~") {
    return null;
  }

  return text[index + 1] === marker && text[index + 2] === marker ? { marker } : null;
}

function findFirstParsedNestedSpan(
  text: string,
  spans: readonly { endIndex: number; startIndex: number }[],
): JsonObjectSpan | null {
  for (const span of spans) {
    const parsedSpan = parseJsonObjectSpan(text, span.startIndex, span.endIndex);
    if (parsedSpan !== null) {
      return parsedSpan;
    }
  }

  return null;
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

function isLikelyJsonObjectStart(text: string, startIndex: number): boolean {
  for (let index = startIndex + 1; index < text.length; index += 1) {
    const character = text[index];
    if (character === " " || character === "\n" || character === "\r" || character === "\t") {
      continue;
    }

    return character === '"' || character === "}";
  }

  return false;
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
