import { describe, expect, it } from "vitest";

import { selectPreferredThreadId } from "./thread-selection.js";

describe("selectPreferredThreadId", () => {
  it("prefers the oldest created loaded thread when details are available", () => {
    const result = selectPreferredThreadId({
      availableThreads: [
        {
          id: "thread_old",
          name: null,
          preview: null,
          updatedAt: 10,
          createdAt: 1,
        },
        {
          id: "thread_new",
          name: null,
          preview: null,
          updatedAt: 20,
          createdAt: 2,
        },
      ],
      loadedThreadIds: ["thread_old", "thread_new"],
    });

    expect(result).toBe("thread_old");
  });

  it("falls back to the first loaded thread when it is missing from the available list", () => {
    const result = selectPreferredThreadId({
      availableThreads: [],
      loadedThreadIds: ["thread_loaded_only"],
    });

    expect(result).toBe("thread_loaded_only");
  });

  it("falls back to the oldest created available thread when nothing is loaded", () => {
    const result = selectPreferredThreadId({
      availableThreads: [
        {
          id: "thread_a",
          name: null,
          preview: null,
          updatedAt: null,
          createdAt: 10,
        },
        {
          id: "thread_b",
          name: null,
          preview: null,
          updatedAt: 30,
          createdAt: 5,
        },
      ],
      loadedThreadIds: [],
    });

    expect(result).toBe("thread_b");
  });

  it("returns null when no thread can be selected", () => {
    const result = selectPreferredThreadId({
      availableThreads: [],
      loadedThreadIds: [],
    });

    expect(result).toBeNull();
  });
});
