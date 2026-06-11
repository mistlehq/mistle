import { describe, expect, it } from "vitest";

import { supportsAssociatedResourceDeliveryRuntime } from "./association-delivery.js";

describe("supportsAssociatedResourceDeliveryRuntime", () => {
  it("returns true only when the compiled agent runtime declares associated-resource delivery support", () => {
    expect(
      supportsAssociatedResourceDeliveryRuntime({
        capabilities: {
          associatedResourceDelivery: {
            supported: true,
          },
        },
      }),
    ).toBe(true);

    expect(supportsAssociatedResourceDeliveryRuntime({})).toBe(false);
    expect(
      supportsAssociatedResourceDeliveryRuntime({
        capabilities: {},
      }),
    ).toBe(false);
  });
});
