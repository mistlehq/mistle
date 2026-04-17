import { render, screen } from "@testing-library/react";

import {
  Combobox,
  ComboboxContent,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "./combobox.js";

it("adds left padding to the closed combobox input so values do not sit against the border", () => {
  render(
    <Combobox defaultValue="GitHub">
      <ComboboxInput placeholder="Select integration" />
      <ComboboxContent>
        <ComboboxList>
          <ComboboxItem value="GitHub">GitHub</ComboboxItem>
          <ComboboxItem value="Linear">Linear</ComboboxItem>
        </ComboboxList>
      </ComboboxContent>
    </Combobox>,
  );

  const input = screen.getByRole("combobox");

  expect(input.className).toContain("pl-2.5");
});
