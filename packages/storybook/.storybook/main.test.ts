import { describe, expect, it } from "vitest";

import { stripViteHotContextPreamble } from "./main.js";

describe("storybook main config", () => {
  it("strips Vite's transformed-source hot context preamble from fresh story modules", () => {
    const transformedCode = [
      'import { createHotContext as __vite__createHotContext } from "/@vite/client";import.meta.hot = __vite__createHotContext("/apps/dashboard/src/example.stories.tsx");',
      'import { Button } from "/@fs/packages/ui/src/button.tsx";',
      "export const Default = {};",
    ].join("");

    expect(stripViteHotContextPreamble(transformedCode)).toBe(
      'import { Button } from "/@fs/packages/ui/src/button.tsx";export const Default = {};',
    );
  });

  it("leaves modules without Vite's hot context preamble unchanged", () => {
    const transformedCode = 'import { Button } from "/@fs/packages/ui/src/button.tsx";';

    expect(stripViteHotContextPreamble(transformedCode)).toBe(transformedCode);
  });
});
