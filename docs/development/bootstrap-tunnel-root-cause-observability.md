# Bootstrap Tunnel Root-Cause Observability

Bootstrap tunnel missed-pong incidents need positive root-cause attribution, not only theory
elimination. The diagnostic target is a connection-scoped evidence ladder:

1. Gateway schedules health ping sequence.
2. Gateway enqueues the websocket control frame.
3. Gateway websocket write callback fires or errors.
4. Gateway socket byte counters advance.
5. Gateway node flow telemetry shows TCP bytes sent, ACKed, retransmitted, or dropped.
6. GCLB records the websocket request lifetime and backend close status.
7. Provider ingress or sandbox TCP state observes the bytes.
8. Sandboxd socket read advances.
9. Sandboxd decodes the websocket frame and enters the control-frame handler.
10. Sandboxd queues and writes the pong.
11. Gateway receives and matches the pong before the health deadline.

Each incident bundle should classify the failure into one root-cause class with required
positive evidence, disqualifying evidence, and a confidence level. Useful classes include:

- `gateway-reader-starved`
- `gateway-write-stalled-before-kernel`
- `node-egress-loss-or-retransmit`
- `gclb-backend-close-or-timeout`
- `provider-ingress-loss`
- `sandboxd-parser-or-handler-stall`
- `sandboxd-writer-backpressure`
- `gateway-health-accounting-bug`
- `unknown-insufficient-evidence`

## Instrumentation Phases

1. Gateway websocket health timeline:
   - ping sequence, send deadline, pong deadline, write callback timing, callback error,
     pong match, miss, recovery, degrade, and close decision.
   - socket ready state and buffered amount available from the websocket adapter.
   - receive-loop state, latest frame/control frame, read error, close frame, and timer drift.

2. Connection identity and diagnostics:
   - generate a `bootstrapConnectionId` for each tunnel connection and reconnect generation.
   - attach it to gateway logs, sandboxd logs, lifecycle events, incident bundles, and a
     GCLB-visible request field if access logs retain it for websocket upgrades.
   - keep fallback correlation keys: 5-tuple, backend pod IP, gateway pod UID, start time
     bucket, sandbox id, and gateway version.

3. Sandboxd layered receive/write telemetry:
   - socket read activity, websocket frame decoded, control handler entered, app heartbeat
     received, pong queued, pong write started, pong write completed, pong write failed.
   - writer queue depth, lifecycle causality, detach/shutdown initiator, timeout source, and
     gateway health state at detach.

4. Protocol-level heartbeat:
   - add an application heartbeat over the normal tunnel data path, independent from websocket
     control ping.
   - record misses and recoveries, and sample successful RTTs.
   - document whether it shares the same websocket, TCP socket, write queue, event loop, and
     backpressure path as health pings.

5. GCLB and GKE evidence:
   - validate GCLB access-log taxonomy for backend close, client close, timeout, drain, RST,
     FIN, and network blackhole before relying on `statusDetails`.
   - keep metrics low-cardinality: region, cluster, service, backend zone, gateway version,
     status class, and root-cause class.
   - keep high-cardinality connection ids and 5-tuples in logs or short-lived incident bundles,
     not metric labels.
   - maintain a small rolling ring buffer per active bootstrap connection for recent TCP/socket
     metadata, then flush it only on incident.
   - capture node flow evidence for the exact incident 5-tuple: TCP state, ACK progress,
     retransmits, zero-window, RST/FIN direction, conntrack pressure, NAT errors, and CNI drops.
   - collect byte counters and local or remote socket addresses from a typed socket or node-flow
     source; do not scrape private websocket implementation fields for these values.

6. Provider evidence:
   - enumerate available provider artifacts before treating provider ingress as positively
     proven: VM or container NIC counters, ingress or NAT logs, packet drops, host migration,
     maintenance events, sandbox local TCP state, and runtime agent logs.
   - if provider artifacts are unavailable, label provider attribution as an escalation claim
     supported by Mistle-side boundary evidence, not as a proven root cause.

7. Validation:
   - fault-inject event-loop stalls, gateway egress drops, retransmits, RST/FIN, GCLB backend
     drain, sandboxd reader pauses, sandboxd writer backpressure, delayed pongs, duplicate pongs,
     stale pongs, reconnect generation mismatches, and post-detach shutdowns.
   - each injected failure should land in the intended root-cause class.

## Cost Controls

- Do not store websocket payloads.
- Do not enable broad packet capture by default.
- Record all failures, but sample successful RTTs and heartbeat traces.
- Keep high-cardinality fields out of metrics.
- Bound incident capture by pod, connection, and time window.
- Run deep capture asynchronously and record diagnostic drops or skips.
- Retain deep diagnostic bundles for a short TTL.
