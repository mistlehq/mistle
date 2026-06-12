# Sandbox-Scoped Provider Resource Associations

Provider resource associations are registered from managed egress as sandbox-scoped links from a routable provider resource to the sandbox session that observed the resource creation, rather than as links to a persisted runtime conversation. The data-plane gateway reports first-pass GitHub pull request creation observations directly to the control plane, and association delivery resolves the sandbox session's original runtime conversation at delivery time. This avoids adding durable dashboard runtime-conversation persistence while still routing PR comments and reviews back into the originating sandbox session; if original conversation resolution is unavailable or conflicting, delivery fails explicitly instead of falling back to an active or newly created conversation.

Agent runtimes support association delivery only when Mistle can resolve the sandbox session's original runtime conversation for that runtime. Association delivery must use that original conversation, not the active, selected, recent, or most recently updated runtime conversation. For runtimes with paginated or capped conversation lists, delivery should exhaust the runtime's available lookup path to find the earliest-created conversation before failing; UI navigator page-size limits are not association-delivery limits.

Provider resource association records use a single normalized table for the first pass, keyed by integration connection, resource kind, and provider resource identity. They do not duplicate provider family, provider variant, or target key; routing code derives those through the integration connection when needed. The first-pass uniqueness scope makes a provider resource single-owner per integration connection, resource kind, and provider resource id so one provider webhook does not accidentally fan out to multiple sandbox sessions. If product behavior later supports multi-association fanout, loosen the uniqueness scope to include `sandbox_instance_id` and update registration conflict handling and delivery UX together.

For first-pass GitHub pull request associations, the provider resource identity is the canonical `owner/repository#pull-number` tuple, for example `mistlehq/mistle#2781`. GitHub webhook payloads for pull request issue comments, reviews, and review comments all carry repository full name plus pull request number, so this key is stable across creation responses and later webhook events without requiring provider-specific database ids to be present on every payload.

Provider resource association records do not store event filters. Filters are authored as associated resource event routing configuration on the relevant sandbox profile version, then compiled into `CompiledRuntimePlan.associatedResourceEventRouting` for sessions started from that version. Registration and delivery both use the captured runtime behavior from the persisted `CompiledRuntimePlan`, not mutable profile tables. During delivery, the control plane first matches the provider event to association rows by integration connection, resource kind, and provider resource identity, then evaluates the associated resource event routing behavior captured for each associated sandbox session before rendering and delivering an association input.

The first-pass implementation adds associated resource event routing as a first-class field on `CompiledRuntimePlan`. The data plane persists that field with the active sandbox instance runtime plan, and registration and delivery read the captured runtime behavior from that persisted plan. The field is generated from sandbox profile version compilation and is not separately editable.

Association-backed delivery uses association-specific persistence rather than a shared polymorphic delivery table with trigger runs. Trigger runs and association deliveries have different domain anchors, idempotency keys, and diagnostics. Shared implementation is limited to lower-level conversation delivery mechanics where the code paths naturally overlap.

Association-backed delivery preserves ordering per provider resource association. Delivery workers process accepted events for the same association in source order rather than submitting them concurrently to the same routing runtime conversation.

Webhook ingestion synchronously creates durable association delivery rows for accepted association-backed provider events, then hands off processing asynchronously. Agent message delivery is not performed inline with the provider webhook response.

The same provider webhook event can match both Trigger configuration and association-backed routing. Trigger delivery and association-backed delivery represent different configured intents and maintain separate idempotency scopes, but association-backed delivery wins when both matches would submit provider follow-up work into the same sandbox session for the same provider webhook event. In that collision case, the duplicate Trigger match is not materialized as a Trigger run unless product behavior later introduces an explicit "deliver both" configuration.

Association-backed delivery uses association delivery context rather than trigger delivery context. The runtime-visible metadata is anchored to the provider resource association, association delivery, source webhook event, sandbox instance, and trace context; it does not synthesize trigger run or trigger conversation identifiers.

The first-pass schema uses `provider_resource_associations` with `integration_connection_id`, `resource_kind`, `provider_resource_id`, and `sandbox_instance_id`, unique across `integration_connection_id`, `resource_kind`, and `provider_resource_id`. It also uses `provider_resource_association_deliveries` with `provider_resource_association_id`, `source_webhook_event_id`, `source_order_key`, rendered input, status, attempt count, failure fields, and lifecycle timestamps. Deliveries are unique per association and source webhook event. It also uses `provider_resource_association_delivery_processors` keyed by provider resource association to coordinate ordered asynchronous processing for each association.

The data-plane gateway registers observed provider resources through an internal control-plane API after managed egress observes a first-pass GitHub pull request creation response. The registration request supplies only the integration connection id, resource kind, provider resource id, and sandbox instance id. The control plane validates the integration connection and records the association idempotently.

Webhook ingestion runs association matching as a sibling to Trigger matching after the provider webhook event is normalized and persisted. Association matching finds provider resource associations by integration connection, resource kind, and provider resource id, evaluates the associated resource event routing behavior captured for each associated sandbox session, and inserts delivery rows idempotently.

Association matching rejects self-authored association events before creating association delivery rows. The provider webhook event remains persisted and can still produce Trigger runs or other webhook side effects, but the self-authored association event is not represented as an ignored delivery because no delivery attempt should exist.

First-pass self-authorship suppression does not create a separate user-visible history entry or operator diagnostic record. The persisted webhook event remains the durable record that the provider event was received.

If self-authorship suppression leaves no Trigger runs, resource sync requests, or Association deliveries, webhook processing may finalize the persisted webhook event as ignored. Association preparation does not return a separate matched-but-suppressed result.

Provider definitions own self-authorship evaluation because provider actor identity is provider-specific. The control-plane worker asks the integration definition whether an observed association event is self-authored for the integration connection rather than interpreting provider payload actor fields generically.

First-pass self-authorship is evaluated at the integration connection's provider-actor level, not by correlating an inbound provider event to a specific outbound sandbox action. If the same provider actor Mistle uses for the integration connection authored the event, association matching rejects it even without proving which sandbox session produced the outbound action.

Associated-resource event observation and self-authorship evaluation belong to a dedicated integration definition capability rather than the webhook-source lifecycle capability. Webhook-source hooks answer how Mistle owns provider webhook registrations; associated-resource hooks answer whether a normalized provider event can continue an associated sandbox session.

Associated-resource actor metadata stays identity-oriented in the first pass. The capability may expose provider subject identifiers and provider handles needed for self-authorship checks, but it does not introduce a generic provider actor kind taxonomy until a concrete provider use case needs one.

Actor metadata used for self-authorship does not change first-pass rendered association input. Rendered association input continues to include provider-authored context chosen for the agent prompt, not routing diagnostics or provider actor identifiers that are only needed for suppression.

Self-authorship is a strict suppression decision. If the provider capability cannot prove that an observed association event was authored by Mistle's provider actor for the integration connection, association matching treats the event as not self-authored and continues ordinary routing.

Providers without an associated-resource self-authorship hook deliver observed association events normally. Missing self-authorship support is not a suppression signal.

The GitHub first pass suppresses GitHub App installation actor echoes, not linked-user-authored events. Human linked-user activity can represent real review feedback and should continue through ordinary association routing unless a later provider-specific use case justifies narrower behavior.

Association matching evaluates captured associated resource event routing before self-authorship. Self-authorship is only evaluated for events that would otherwise be eligible for an Association delivery, keeping routing-disabled events distinct from self-authored suppression.

Association matching resolves captured runtime behavior from data-plane sandbox instance runtime-plan state. The association row stores only the sandbox instance id; it does not duplicate sandbox profile id, sandbox profile version, or associated resource event routing configuration. The first-pass implementation extends the existing control-plane internal sandbox read facade to expose the data-plane `sandboxProfileId`, `sandboxProfileVersion`, and the `associatedResourceEventRouting` captured in the persisted `CompiledRuntimePlan`. The routing field is nullable on this status-oriented facade while a newly started sandbox instance exists before its runtime plan has been persisted; association registration treats that state as not applicable rather than failing status polling.

Association registration validates tenant consistency between the integration connection and sandbox instance before recording the association. The integration connection's organization and the data-plane sandbox instance's organization must match.

First-pass GitHub pull request association registration is detected from managed egress HTTP responses for successful GitHub pull request creation requests, not from CLI output. The data-plane gateway observes `POST /repos/{owner}/{repo}/pulls`, extracts repository full name plus pull request number from the successful provider response body, and reports `owner/repository#pull-number` to the control plane.

The data-plane gateway does not evaluate associated resource event routing filters or decide profile/runtime eligibility. It only classifies whether a managed egress response produced a routable provider resource and sends the observed resource details to the control plane. The control plane owns eligibility checks, tenant validation, idempotent persistence, and later event filtering. When the captured runtime behavior does not support the observed resource kind, the control plane returns an explicit non-created registration result rather than relying on gateway-side filtering.

If the GitHub pull request creation response succeeds but association registration fails, the gateway still returns the original successful provider response to the sandbox. Registration failure is recorded through logs or telemetry because the external provider side effect has already occurred and returning a failure could cause duplicate pull request creation.

Association registration only records provider resources for sandbox sessions whose persisted `CompiledRuntimePlan.associatedResourceEventRouting` supports the observed resource kind. First-pass GitHub pull request creation does not create an association when the sandbox session's captured runtime behavior has no GitHub pull request association routing configured.

GitHub pull request association routing is enabled by default for compatible sandbox profile versions in the first pass. The default accepted event set is pull request issue comments, pull request reviews, and pull request review comments. Profile-version configuration may disable or narrow this behavior.

Rendered association input is concise structured plain text derived from the provider event, not raw JSON. Raw provider payloads remain on the persisted webhook event for diagnostics and future rendering changes.

The first-pass dashboard UI configures associated resource event routing as part of the sandbox profile version editor and publish/snapshot lifecycle. It does not expose association records as user-managed resources, and it does not support manually adding or removing provider resource associations.
