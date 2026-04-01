# Data Plane Gateway

This app owns sandbox tunnel termination, connection-peer routing, and published-target edge
proxying.

## Published Targets

Published targets are browser-facing hosts that map to one exact sandbox target. In the current
backend implementation the target type is a localhost port discovered and authorized by `sandboxd`.

Host shape:

- local development: `p-5173--sbi_123.mistle.localhost`
- deployed/self-hosted/cloud: `p-5173--sbi_123.<sandbox.publish.baseDomain>`

The hostname model is intentionally flat. We do not use nested names such as
`*.preview.<domain>` because the backend needs one wildcard-compatible label shape that works
locally, in self-hosted installs, and behind Cloudflare-managed certificates.

## Local Behavior

Local development uses:

- `sandbox.publish.baseDomain = "mistle.localhost"`
- plain HTTP and plain WS at the edge
- host-scoped published-target session cookies without `Secure`

That means a local published target flow looks like:

1. bootstrap `http://p-5173--sbi_123.mistle.localhost/_mistle/bootstrap?token=...`
2. gateway verifies the signed token against the exact host
3. gateway sets a host-scoped session cookie for that published host
4. later HTTP and WS requests on the same host proxy over the bootstrap tunnel

## Deployed Behavior

Deployed environments use:

- `sandbox.publish.baseDomain`
- HTTPS and WSS at the edge
- `Secure` host-scoped published-target session cookies

Every environment provides its own `sandbox.publish.baseDomain`. The gateway does not branch
between separate local and deployed base-domain settings.

## Header Policy

For localhost-port publishing, the gateway rewrites upstream headers to reduce dev-server host
validation failures:

- HTTP `Host`: `localhost:<port>`
- WebSocket `Origin`: `http://localhost:<port>` or `https://localhost:<port>` depending on the
  browser-visible scheme
- `X-Forwarded-Host`, `X-Forwarded-Proto`, and `X-Forwarded-Port` always reflect the
  browser-visible published origin

The gateway does not keep a semantic target registry. It only keeps transport state for in-flight
HTTP and WebSocket publish streams while `sandboxd` remains the source of truth for listener
discovery and target visibility.
