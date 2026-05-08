// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { TablePagination } from "./table-pagination.js";

function failIfPaginationActionRuns(): never {
  throw new Error("Pagination action should not run.");
}

describe("TablePagination", () => {
  it("does not render controls when there is only one page", () => {
    render(
      <TablePagination
        hasNextPage={false}
        hasPreviousPage={false}
        onNextPage={failIfPaginationActionRuns}
        onPreviousPage={failIfPaginationActionRuns}
      />,
    );

    expect(screen.queryByLabelText("pagination")).toBeNull();
  });

  it("uses the shared pagination links for page navigation", () => {
    const visitedPages: string[] = [];

    render(
      <TablePagination
        hasNextPage
        hasPreviousPage
        onNextPage={() => {
          visitedPages.push("next");
        }}
        onPreviousPage={() => {
          visitedPages.push("previous");
        }}
      />,
    );

    const pagination = screen.getByLabelText("pagination");
    expect(pagination.getAttribute("data-slot")).toBe("pagination");

    fireEvent.click(screen.getByRole("button", { name: "Go to previous page" }));
    fireEvent.click(screen.getByRole("button", { name: "Go to next page" }));

    expect(visitedPages).toEqual(["previous", "next"]);
  });

  it("marks unavailable page links as disabled and ignores clicks", () => {
    const visitedPages: string[] = [];

    render(
      <TablePagination
        hasNextPage
        hasPreviousPage={false}
        nextPageDisabled
        onNextPage={() => {
          visitedPages.push("next");
        }}
        onPreviousPage={() => {
          visitedPages.push("previous");
        }}
      />,
    );

    const previousPage = screen.getByRole("button", { name: "Go to previous page" });
    const nextPage = screen.getByRole("button", { name: "Go to next page" });

    expect(previousPage.getAttribute("aria-disabled")).toBe("true");
    expect(previousPage.getAttribute("tabindex")).toBe("-1");
    expect(nextPage.getAttribute("aria-disabled")).toBe("true");
    expect(nextPage.getAttribute("tabindex")).toBe("-1");

    fireEvent.click(previousPage);
    fireEvent.click(nextPage);

    expect(visitedPages).toEqual([]);
  });
});
