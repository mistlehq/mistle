import { describe, expect, it } from "vitest";

import { buildTokenizerProxyRequest, HEADER_EGRESS_GRANT } from "./forwarder.js";

describe("buildTokenizerProxyRequest", () => {
  it("uses header-addressed tokenizer path and forwards the signed grant", () => {
    const request = buildTokenizerProxyRequest({
      tokenizerProxyEgressBaseUrl: "http://tokenizer-proxy.internal/tokenizer-proxy/egress",
      egressGrant: "signed-egress-grant",
      targetPath: "/v1/responses",
      rawQuery: "stream=true",
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: undefined,
    });

    expect(request.url.pathname).toBe("/tokenizer-proxy/egress/v1/responses");
    expect(request.url.search).toBe("?stream=true");
    expect(request.headers[HEADER_EGRESS_GRANT]).toBe("signed-egress-grant");
  });
});
