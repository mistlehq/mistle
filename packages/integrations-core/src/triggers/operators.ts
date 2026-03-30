function isTokenBoundaryCharacter(value: string): boolean {
  return !/[\p{L}\p{N}\p{M}_]/u.test(value);
}

function getCodePointBefore(input: { value: string; index: number }): string | null {
  if (input.index <= 0) {
    return null;
  }

  const precedingCodeUnit = input.value.charCodeAt(input.index - 1);
  if (precedingCodeUnit >= 0xdc00 && precedingCodeUnit <= 0xdfff && input.index >= 2) {
    const leadingCodeUnit = input.value.charCodeAt(input.index - 2);
    if (leadingCodeUnit >= 0xd800 && leadingCodeUnit <= 0xdbff) {
      return input.value.slice(input.index - 2, input.index);
    }
  }

  return input.value.slice(input.index - 1, input.index);
}

function getCodePointAfter(input: { value: string; index: number }): string | null {
  if (input.index >= input.value.length) {
    return null;
  }

  const trailingCodeUnit = input.value.charCodeAt(input.index);
  if (
    trailingCodeUnit >= 0xd800 &&
    trailingCodeUnit <= 0xdbff &&
    input.index + 1 < input.value.length
  ) {
    const followingCodeUnit = input.value.charCodeAt(input.index + 1);
    if (followingCodeUnit >= 0xdc00 && followingCodeUnit <= 0xdfff) {
      return input.value.slice(input.index, input.index + 2);
    }
  }

  return input.value.slice(input.index, input.index + 1);
}

export function containsToken(input: { value: string; token: string }): boolean {
  if (input.token.length === 0) {
    return false;
  }

  let searchStartIndex = 0;

  while (true) {
    const matchedIndex = input.value.indexOf(input.token, searchStartIndex);
    if (matchedIndex === -1) {
      return false;
    }

    const precedingCharacter = getCodePointBefore({
      value: input.value,
      index: matchedIndex,
    });
    const followingCharacter = getCodePointAfter({
      value: input.value,
      index: matchedIndex + input.token.length,
    });
    const hasLeadingBoundary =
      precedingCharacter === null || isTokenBoundaryCharacter(precedingCharacter);
    const hasTrailingBoundary =
      followingCharacter === null || isTokenBoundaryCharacter(followingCharacter);

    if (hasLeadingBoundary && hasTrailingBoundary) {
      return true;
    }

    searchStartIndex = matchedIndex + 1;
  }
}
