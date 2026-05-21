use std::collections::BTreeSet;
use std::fs;
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpListener as StdTcpListener};
use std::os::unix::fs::PermissionsExt;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::Receiver;
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use hyper::header::HeaderValue;

use crate::egress_proxy::DirectGatewayRouteScheme;
#[cfg(target_os = "linux")]
use crate::egress_proxy::socket_addr_from_sockaddr_storage;
use crate::egress_proxy::{
    DIRECT_EGRESS_HTTP_ROUTE_PATH, DIRECT_EGRESS_WEBSOCKET_ROUTE_PATH,
    DIRECT_GATEWAY_EGRESS_AUTHORIZATION_HEADER_NAME, DirectGatewayEgressClient, EgressProxy,
    EgressProxyForwardingMode, EgressProxyRoute, ProxyCaConfig, RequestTargetOverride,
    TransparentProxyProtocol, build_direct_forward_uri, build_gateway_egress_route,
    build_managed_proxy_env, classify_transparent_proxy_first_byte,
    filter_direct_gateway_request_headers, match_route, resolve_direct_gateway_route_url,
    resolve_request_target, serialize_egress_proxy_log_line, websocket_target_url,
};
use crate::egress_proxy::{
    TRANSPARENT_NFTABLES_TABLE_NAME, build_nftables_install_commands,
    build_nftables_rule_plan_with_local_destinations, parse_iproute2_link_scope_ipv4_route_cidrs,
};
use crate::protocol::startup::{StartupInput, StartupMode};
use crate::protocol::startup::{
    TransparentProxyBypass, TransparentProxyBypassKind, TransparentProxyConfiguration,
    TransparentProxyExclusion, TransparentProxyExclusionKind,
};
use crate::runtime::{
    CompiledEgressRoute, CompiledEgressRouteAuthInjection, CompiledEgressRouteAuthInjectionType,
    CompiledEgressRouteCredentialResolver, CompiledEgressRouteMatch, CompiledEgressRouteUpstream,
    CompiledRuntimePlan,
};
use crate::supervision::{ComponentHealthState, SandboxdSupervisorHandle, SupervisedComponent};
use crate::time::SystemClock;
use crate::time::testing::MutableClock;
use crate::tunnel::session::GatewayEgressTokenProvider;
use serde_json::Value;
use tokio_tungstenite::tungstenite::handshake::derive_accept_key;
use url::Url;

struct TestProxyCaPaths {
    root_directory: PathBuf,
    system_certificate_bundle_path: PathBuf,
    runtime_certificate_path: PathBuf,
    runtime_certificate_bundle_path: PathBuf,
    persistent_certificate_path: PathBuf,
    persistent_private_key_path: PathBuf,
    trust_store_certificate_path: PathBuf,
    refresh_command_path: PathBuf,
    refresh_marker_path: PathBuf,
}

static TEST_PROXY_CA_PATH_COUNTER: AtomicU64 = AtomicU64::new(0);

#[test]
fn matches_route_by_host_path_and_method() {
    let routes = vec![
        EgressProxyRoute {
            egress_rule_id: "egress-rule-a".to_string(),
            hosts: vec!["api.github.com".to_string()],
            path_prefixes: vec!["/graphql".to_string()],
            methods: Some(vec!["POST".to_string()]),
        },
        EgressProxyRoute {
            egress_rule_id: "egress-rule-b".to_string(),
            hosts: vec!["github.com".to_string()],
            path_prefixes: vec!["/mistlehq/mistle.git".to_string()],
            methods: Some(vec!["GET".to_string()]),
        },
    ];

    let graphql_route = match_route(&routes, "api.github.com", "/graphql", "POST")
        .expect("graphql route should match");
    assert_eq!(
        graphql_route
            .expect("graphql route should resolve exactly one match")
            .egress_rule_id,
        "egress-rule-a"
    );

    let git_route = match_route(
        &routes,
        "github.com",
        "/mistlehq/mistle.git/info/refs",
        "GET",
    )
    .expect("git route should match");
    assert_eq!(
        git_route
            .expect("git route should resolve exactly one match")
            .egress_rule_id,
        "egress-rule-b"
    );
}

#[test]
fn leaves_unmatched_requests_for_direct_passthrough() {
    let routes = vec![EgressProxyRoute {
        egress_rule_id: "egress-rule-a".to_string(),
        hosts: vec!["api.openai.com".to_string()],
        path_prefixes: vec!["/v1/responses".to_string()],
        methods: Some(vec!["POST".to_string()]),
    }];

    let route = match_route(
        &routes,
        "deb.debian.org",
        "/debian/dists/bookworm/InRelease",
        "GET",
    )
    .expect("unmatched route evaluation should succeed");

    assert!(route.is_none());
}

#[test]
fn builds_https_direct_forward_uris_for_tunneled_requests() {
    let direct_uri = build_direct_forward_uri(
        "https",
        "api.example.test",
        Some(
            &"/v1/responses?stream=true"
                .parse()
                .expect("path and query should parse"),
        ),
    )
    .expect("direct https forward uri should build");

    assert_eq!(
        direct_uri.to_string(),
        "https://api.example.test/v1/responses?stream=true"
    );
}

#[test]
fn derives_direct_gateway_egress_route_urls_from_bootstrap_tunnel_url() {
    let http_route = resolve_direct_gateway_route_url(
        "wss://gateway.example.test/tunnel/sandbox/sbi_123?x-mistle-test-environment-id=test_env_123",
        DIRECT_EGRESS_HTTP_ROUTE_PATH,
        DirectGatewayRouteScheme::Http,
    )
    .expect("direct HTTP route should resolve");
    let websocket_route = resolve_direct_gateway_route_url(
        "wss://gateway.example.test/tunnel/sandbox/sbi_123?x-mistle-test-environment-id=test_env_123",
        DIRECT_EGRESS_WEBSOCKET_ROUTE_PATH,
        DirectGatewayRouteScheme::WebSocket,
    )
    .expect("direct websocket route should resolve");

    assert_eq!(
        http_route.to_string(),
        "https://gateway.example.test/_mistle/egress/http?x-mistle-test-environment-id=test_env_123"
    );
    assert_eq!(
        websocket_route.to_string(),
        "wss://gateway.example.test/_mistle/egress/ws?x-mistle-test-environment-id=test_env_123"
    );
}

#[test]
fn converts_http_targets_to_websocket_targets_for_direct_gateway_egress() {
    let https_target = websocket_target_url(
        &"https://chatgpt.com/backend-api/codex?model=gpt"
            .parse()
            .expect("target URI should parse"),
    )
    .expect("https target should convert");
    let http_target = websocket_target_url(
        &"http://127.0.0.1:3000/socket"
            .parse()
            .expect("target URI should parse"),
    )
    .expect("http target should convert");

    assert_eq!(
        https_target,
        "wss://chatgpt.com/backend-api/codex?model=gpt"
    );
    assert_eq!(http_target, "ws://127.0.0.1:3000/socket");
}

#[test]
fn resolves_transparent_plaintext_http_targets_from_host_header() {
    let request = hyper::Request::builder()
        .method("GET")
        .uri("/v1/models?limit=1")
        .header("host", "api.openai.com")
        .body(())
        .expect("transparent request should build");
    let (parts, ()) = request.into_parts();

    let target = resolve_request_target(
        &parts,
        Some(&RequestTargetOverride {
            scheme: "http",
            default_authority: "203.0.113.10:80".to_string(),
        }),
    )
    .expect("transparent HTTP target should resolve");

    assert_eq!(target.authority, "api.openai.com");
    assert_eq!(target.host, "api.openai.com");
    assert_eq!(
        target.uri.to_string(),
        "http://api.openai.com/v1/models?limit=1"
    );
}

#[test]
fn resolves_transparent_tls_targets_from_host_header() {
    let request = hyper::Request::builder()
        .method("GET")
        .uri("/backend-api/codex/models")
        .header("host", "chatgpt.com")
        .body(())
        .expect("transparent TLS request should build");
    let (parts, ()) = request.into_parts();

    let target = resolve_request_target(
        &parts,
        Some(&RequestTargetOverride {
            scheme: "https",
            default_authority: "203.0.113.20:443".to_string(),
        }),
    )
    .expect("transparent TLS target should resolve");

    assert_eq!(target.authority, "chatgpt.com");
    assert_eq!(target.host, "chatgpt.com");
    assert_eq!(
        target.uri.to_string(),
        "https://chatgpt.com/backend-api/codex/models"
    );
}

#[test]
fn resolves_transparent_targets_from_original_destination_when_host_header_is_absent() {
    let request = hyper::Request::builder()
        .method("GET")
        .uri("/v1/models?limit=1")
        .body(())
        .expect("transparent request should build");
    let (parts, ()) = request.into_parts();

    let target = resolve_request_target(
        &parts,
        Some(&RequestTargetOverride {
            scheme: "http",
            default_authority: "203.0.113.10:80".to_string(),
        }),
    )
    .expect("transparent fallback target should resolve");

    assert_eq!(target.authority, "203.0.113.10:80");
    assert_eq!(target.host, "203.0.113.10");
    assert_eq!(
        target.uri.to_string(),
        "http://203.0.113.10:80/v1/models?limit=1"
    );
}

#[test]
fn classifies_transparent_proxy_protocol_from_first_byte() {
    assert_eq!(
        classify_transparent_proxy_first_byte(0x16),
        TransparentProxyProtocol::Tls
    );
    assert_eq!(
        classify_transparent_proxy_first_byte(b'G'),
        TransparentProxyProtocol::PlainHttp
    );
    assert_eq!(
        classify_transparent_proxy_first_byte(b'P'),
        TransparentProxyProtocol::PlainHttp
    );
    assert_eq!(
        classify_transparent_proxy_first_byte(0x00),
        TransparentProxyProtocol::Unsupported
    );
}

#[test]
fn bypasses_nat_rewritten_bridge_destinations_before_redirect() {
    let configuration = TransparentProxyConfiguration {
        passthrough_bypass: TransparentProxyBypass {
            kind: TransparentProxyBypassKind::SocketMark,
            mark: 38_514,
        },
        exclusions: vec![
            TransparentProxyExclusion {
                kind: TransparentProxyExclusionKind::Cidr,
                value: "169.254.0.0/16".to_string(),
                reason: "provider metadata traffic must stay direct".to_string(),
            },
            TransparentProxyExclusion {
                kind: TransparentProxyExclusionKind::Cidr,
                value: "192.0.2.0/24".to_string(),
                reason: "provider control traffic must stay direct".to_string(),
            },
        ],
    };

    let plan = build_nftables_rule_plan_with_local_destinations(
        &configuration,
        38_514,
        vec!["172.17.0.0/16".to_string(), "10.88.0.0/16".to_string()],
    )
    .expect("transparent nftables plan should build");
    let commands = build_nftables_install_commands(&plan);

    assert_eq!(plan.table_name, TRANSPARENT_NFTABLES_TABLE_NAME);
    assert_eq!(
        plan.local_destination_ipv4_cidrs,
        vec![
            "10.88.0.0/16",
            "127.0.0.0/8",
            "169.254.0.0/16",
            "172.17.0.0/16"
        ]
    );
    assert_eq!(
        commands,
        vec![
            vec!["add", "table", "ip", "mistle_transparent_egress"],
            vec![
                "add",
                "chain",
                "ip",
                "mistle_transparent_egress",
                "output",
                "{",
                "type",
                "nat",
                "hook",
                "output",
                "priority",
                "-100",
                ";",
                "policy",
                "accept",
                ";",
                "}",
            ],
            vec![
                "add",
                "rule",
                "ip",
                "mistle_transparent_egress",
                "output",
                "meta",
                "mark",
                "38514",
                "log",
                "prefix",
                "\"mistle-tproxy-bypass=mark\"",
                "return",
            ],
            vec![
                "add",
                "rule",
                "ip",
                "mistle_transparent_egress",
                "output",
                "ip",
                "daddr",
                "10.88.0.0/16",
                "log",
                "prefix",
                "\"mistle-tproxy-bypass=local:10.88.0.0/16\"",
                "return",
            ],
            vec![
                "add",
                "rule",
                "ip",
                "mistle_transparent_egress",
                "output",
                "ip",
                "daddr",
                "127.0.0.0/8",
                "log",
                "prefix",
                "\"mistle-tproxy-bypass=local:127.0.0.0/8\"",
                "return",
            ],
            vec![
                "add",
                "rule",
                "ip",
                "mistle_transparent_egress",
                "output",
                "ip",
                "daddr",
                "169.254.0.0/16",
                "log",
                "prefix",
                "\"mistle-tproxy-bypass=local:169.254.0.0/16\"",
                "return",
            ],
            vec![
                "add",
                "rule",
                "ip",
                "mistle_transparent_egress",
                "output",
                "ip",
                "daddr",
                "172.17.0.0/16",
                "log",
                "prefix",
                "\"mistle-tproxy-bypass=local:172.17.0.0/16\"",
                "return",
            ],
            vec![
                "add",
                "rule",
                "ip",
                "mistle_transparent_egress",
                "output",
                "ip",
                "daddr",
                "192.0.2.0/24",
                "log",
                "prefix",
                "\"mistle-tproxy-bypass=excluded:192.0.2.0/24\"",
                "return",
            ],
            vec![
                "add",
                "rule",
                "ip",
                "mistle_transparent_egress",
                "output",
                "tcp",
                "dport",
                "1-65535",
                "redirect",
                "to",
                ":38514",
            ],
        ]
    );
}

#[test]
fn parses_link_scope_ipv4_routes_as_local_destination_cidrs() {
    let cidrs = parse_iproute2_link_scope_ipv4_route_cidrs(
        br#"[
            {"dst":"172.17.0.0/16","dev":"docker0","protocol":"kernel","scope":"link","prefsrc":"172.17.0.1"},
            {"dst":"10.88.0.0/16","dev":"podman0","protocol":"kernel","scope":"link","prefsrc":"10.88.0.1"},
            {"dst":"192.0.2.12","dev":"veth0","protocol":"kernel","scope":"link","prefsrc":"192.0.2.12"}
        ]"#,
    )
    .expect("iproute2 link-scope route JSON should parse");

    assert_eq!(
        cidrs,
        vec!["10.88.0.0/16", "172.17.0.0/16", "192.0.2.12/32"]
    );
}

#[cfg(target_os = "linux")]
#[test]
fn decodes_linux_original_destination_socket_addresses() {
    let expected_address = std::net::Ipv4Addr::new(203, 0, 113, 10);
    let sockaddr = nix::libc::sockaddr_in {
        sin_family: nix::libc::AF_INET as nix::libc::sa_family_t,
        sin_port: 443_u16.to_be(),
        sin_addr: nix::libc::in_addr {
            s_addr: u32::from(expected_address).to_be(),
        },
        sin_zero: [0; 8],
    };
    let mut storage = std::mem::MaybeUninit::<nix::libc::sockaddr_storage>::zeroed();
    unsafe {
        storage
            .as_mut_ptr()
            .cast::<nix::libc::sockaddr_in>()
            .write(sockaddr);
    }

    let decoded = socket_addr_from_sockaddr_storage(
        unsafe { storage.assume_init() },
        std::mem::size_of::<nix::libc::sockaddr_in>()
            .try_into()
            .expect("sockaddr_in length should fit socklen_t"),
    )
    .expect("IPv4 original destination should decode");

    assert_eq!(decoded, SocketAddr::from((expected_address, 443)));
}

#[test]
fn managed_proxy_env_includes_ca_variables_without_proxy_routing() {
    let env = build_managed_proxy_env(std::path::Path::new(
        "/run/mistle/sandboxd/egress-proxy-ca-bundle.pem",
    ))
    .expect("managed proxy environment should build");

    assert!(!env.contains_key("HTTP_PROXY"));
    assert!(!env.contains_key("HTTPS_PROXY"));
    assert!(!env.contains_key("ALL_PROXY"));
    assert!(!env.contains_key("NO_PROXY"));
    assert!(!env.contains_key("http_proxy"));
    assert!(!env.contains_key("https_proxy"));
    assert!(!env.contains_key("all_proxy"));
    assert!(!env.contains_key("no_proxy"));
    assert_eq!(
        env.get("SSL_CERT_FILE"),
        Some(&"/run/mistle/sandboxd/egress-proxy-ca-bundle.pem".to_string())
    );
    assert_eq!(
        env.get("NIX_SSL_CERT_FILE"),
        Some(&"/run/mistle/sandboxd/egress-proxy-ca-bundle.pem".to_string())
    );
    assert!(!EgressProxy::managed_env_keys().contains(&"HTTPS_PROXY"));
    assert!(EgressProxy::managed_env_keys().contains(&"NODE_EXTRA_CA_CERTS"));
    assert!(EgressProxy::managed_env_keys().contains(&"NIX_SSL_CERT_FILE"));
}

#[test]
fn unmatched_plain_http_requests_go_direct_without_gateway() {
    let (upstream_address, upstream_request_receiver, upstream_server) =
        start_single_request_http_server("direct-upstream");
    let listener_address = reserve_test_listener_address();
    let proxy_ca_paths = test_proxy_ca_paths();
    let runtime_plan = sample_runtime_plan();
    let startup_input = sample_startup_input();
    let supervisor_handle = SandboxdSupervisorHandle::new(
        "sandbox-123",
        Arc::new(SystemClock),
        BTreeSet::from([SupervisedComponent::EgressProxy]),
    );
    let proxy = EgressProxy::start_with_options(
        &runtime_plan,
        &startup_input,
        test_forwarding_mode(),
        listener_address,
        test_proxy_ca_config(&proxy_ca_paths),
        Arc::new(SystemClock),
        supervisor_handle,
    )
    .expect("egress proxy start should succeed")
    .expect("egress proxy should be configured");

    let response = send_proxy_http_request(
        listener_address,
        &format!("http://{upstream_address}/unmanaged?source=test"),
    );
    let upstream_request = upstream_request_receiver
        .recv_timeout(Duration::from_secs(5))
        .expect("unmatched request should reach the direct upstream");

    assert!(
        response.contains("direct-upstream"),
        "proxy response should come from direct upstream: {response}"
    );
    assert!(
        upstream_request.starts_with("GET /unmanaged?source=test HTTP/1.1\r\n"),
        "direct upstream should receive an origin-form request: {upstream_request}"
    );

    proxy.close().expect("egress proxy close should succeed");
    upstream_server
        .join()
        .expect("direct upstream server thread should join");
    let _ = fs::remove_dir_all(&proxy_ca_paths.root_directory);
}

#[test]
fn unmatched_websocket_upgrades_go_direct_without_gateway() {
    let (upstream_address, upstream_request_receiver, upstream_server) =
        start_single_request_websocket_server();
    let listener_address = reserve_test_listener_address();
    let proxy_ca_paths = test_proxy_ca_paths();
    let runtime_plan = sample_runtime_plan();
    let startup_input = sample_startup_input();
    let supervisor_handle = SandboxdSupervisorHandle::new(
        "sandbox-123",
        Arc::new(SystemClock),
        BTreeSet::from([SupervisedComponent::EgressProxy]),
    );
    let proxy = EgressProxy::start_with_options(
        &runtime_plan,
        &startup_input,
        test_forwarding_mode(),
        listener_address,
        test_proxy_ca_config(&proxy_ca_paths),
        Arc::new(SystemClock),
        supervisor_handle,
    )
    .expect("egress proxy start should succeed")
    .expect("egress proxy should be configured");

    let response = send_proxy_websocket_handshake(
        listener_address,
        &format!("ws://{upstream_address}/unmanaged-socket"),
    );
    let upstream_request = upstream_request_receiver
        .recv_timeout(Duration::from_secs(5))
        .expect("unmatched websocket should reach the direct upstream");

    assert!(
        response.starts_with("HTTP/1.1 101 Switching Protocols\r\n"),
        "proxy websocket response should come from direct upstream: {response}"
    );
    assert!(
        upstream_request.starts_with("GET /unmanaged-socket HTTP/1.1\r\n"),
        "direct websocket upstream should receive an origin-form request: {upstream_request}"
    );

    proxy.close().expect("egress proxy close should succeed");
    upstream_server
        .join()
        .expect("direct upstream websocket server thread should join");
    let _ = fs::remove_dir_all(&proxy_ca_paths.root_directory);
}

#[test]
fn direct_gateway_request_headers_preserve_upstream_authorization() {
    let request = hyper::Request::builder()
        .method("GET")
        .uri("https://api.example.test/v1/models")
        .header("authorization", "Bearer upstream-token")
        .header(
            DIRECT_GATEWAY_EGRESS_AUTHORIZATION_HEADER_NAME,
            "Bearer gateway-token",
        )
        .header("accept", "application/json")
        .body(())
        .expect("request should build");
    let (parts, ()) = request.into_parts();

    let headers = filter_direct_gateway_request_headers(&parts.headers);

    assert!(
        headers
            .iter()
            .any(|(name, value)| name.as_str() == "authorization"
                && value == HeaderValue::from_static("Bearer upstream-token"))
    );
    assert!(
        headers
            .iter()
            .all(|(name, _)| name.as_str() != DIRECT_GATEWAY_EGRESS_AUTHORIZATION_HEADER_NAME)
    );
    assert!(
        headers.iter().any(|(name, value)| name.as_str() == "accept"
            && value == HeaderValue::from_static("application/json")),
        "non-hop-by-hop request headers should still be preserved"
    );
}

#[test]
fn gateway_egress_routes_do_not_require_local_egress_grants() {
    let runtime_plan = sample_runtime_plan();
    let route = build_gateway_egress_route(&runtime_plan.egress_routes[0])
        .expect("gateway egress route should build");

    assert_eq!(route.egress_rule_id, "egress-rule-1");
    assert_eq!(route.hosts, vec!["api.openai.com"]);
}

#[test]
fn gateway_egress_routes_match_declared_hosts_not_upstream_host() {
    let mut runtime_plan = sample_runtime_plan();
    runtime_plan.egress_routes[0].r#match.hosts = vec!["API.GITHUB.COM".to_string()];
    runtime_plan.egress_routes[0].upstream.base_url = "https://proxy.github.internal".to_string();

    let route = build_gateway_egress_route(&runtime_plan.egress_routes[0])
        .expect("gateway egress route should build");

    assert_eq!(route.hosts, vec!["api.github.com"]);
    assert!(
        match_route(&[route], "API.GITHUB.COM", "/v1/chat/completions", "POST")
            .expect("declared host should match")
            .is_some()
    );
}

#[test]
fn serializes_structured_egress_proxy_logs() {
    let clock = MutableClock::new(1_750_000_000_000);

    let serialized = serialize_egress_proxy_log_line(
        &clock,
        "sandbox-123",
        "egress_proxy_request_started",
        &[("requestId", Value::String("egp_1".to_string()))],
    )
    .expect("egress proxy log should serialize");

    let parsed: Value =
        serde_json::from_str(&serialized).expect("egress proxy log should be valid json");
    assert_eq!(parsed["event"], "egress_proxy_request_started");
    assert_eq!(parsed["sandboxInstanceId"], "sandbox-123");
    assert_eq!(parsed["component"], "EgressProxy");
    assert_eq!(parsed["requestId"], "egp_1");
    assert!(parsed["observedAt"].as_str().is_some());
}

#[test]
fn keeps_a_stable_proxy_address_across_close_and_restart() {
    let listener_address = reserve_test_listener_address();
    let proxy_ca_paths = test_proxy_ca_paths();
    let runtime_plan = sample_runtime_plan();
    let startup_input = sample_startup_input();
    let supervisor_handle = SandboxdSupervisorHandle::new(
        "sandbox-123",
        Arc::new(SystemClock),
        BTreeSet::from([SupervisedComponent::EgressProxy]),
    );

    let proxy_one = EgressProxy::start_with_options(
        &runtime_plan,
        &startup_input,
        test_forwarding_mode(),
        listener_address,
        test_proxy_ca_config(&proxy_ca_paths),
        Arc::new(SystemClock),
        supervisor_handle.clone(),
    )
    .expect("first egress proxy start should succeed")
    .expect("egress proxy should be configured");
    let proxy_one_ca_path = proxy_one
        .runtime_env()
        .get("SSL_CERT_FILE")
        .cloned()
        .expect("proxy env should include SSL_CERT_FILE");
    proxy_one
        .close()
        .expect("first egress proxy close should succeed");

    let proxy_two = EgressProxy::start_with_options(
        &runtime_plan,
        &startup_input,
        test_forwarding_mode(),
        listener_address,
        test_proxy_ca_config(&proxy_ca_paths),
        Arc::new(SystemClock),
        supervisor_handle.clone(),
    )
    .expect("second egress proxy start should succeed")
    .expect("egress proxy should still be configured");
    let proxy_two_ca_path = proxy_two
        .runtime_env()
        .get("SSL_CERT_FILE")
        .cloned()
        .expect("proxy env should include SSL_CERT_FILE");
    assert_eq!(proxy_two_ca_path, proxy_one_ca_path);
    let snapshot = supervisor_handle
        .component_snapshot(SupervisedComponent::EgressProxy)
        .expect("egress proxy should be tracked");
    assert_eq!(
        snapshot.details.get("listenAddr"),
        Some(&listener_address.to_string())
    );
    assert_eq!(
        snapshot.details.get("stablePort"),
        Some(&listener_address.port().to_string())
    );
    proxy_two
        .close()
        .expect("second egress proxy close should succeed");
    let _ = fs::remove_dir_all(&proxy_ca_paths.root_directory);
}

#[test]
fn restarts_the_proxy_after_the_live_server_exits() {
    let listener_address = reserve_test_listener_address();
    let proxy_ca_paths = test_proxy_ca_paths();
    let runtime_plan = sample_runtime_plan();
    let startup_input = sample_startup_input();
    let supervisor_handle = SandboxdSupervisorHandle::new(
        "sandbox-123",
        Arc::new(SystemClock),
        BTreeSet::from([SupervisedComponent::EgressProxy]),
    );

    let proxy = EgressProxy::start_with_options(
        &runtime_plan,
        &startup_input,
        test_forwarding_mode(),
        listener_address,
        test_proxy_ca_config(&proxy_ca_paths),
        Arc::new(SystemClock),
        supervisor_handle.clone(),
    )
    .expect("egress proxy start should succeed")
    .expect("egress proxy should be configured");
    let stable_ca_path = proxy
        .runtime_env()
        .get("SSL_CERT_FILE")
        .cloned()
        .expect("proxy env should include SSL_CERT_FILE");

    proxy
        .force_current_server_shutdown_for_test()
        .expect("forced shutdown command should reach the supervisor");
    wait_for_egress_snapshot(
        &supervisor_handle,
        ComponentHealthState::Healthy,
        1,
        Duration::from_secs(5),
    );
    assert_eq!(
        proxy.runtime_env().get("SSL_CERT_FILE"),
        Some(&stable_ca_path)
    );
    proxy.close().expect("egress proxy close should succeed");
    let _ = fs::remove_dir_all(&proxy_ca_paths.root_directory);
}

#[test]
fn installs_combined_ca_bundle_and_keeps_persistent_ca_material_after_close() {
    let listener_address = reserve_test_listener_address();
    let proxy_ca_paths = test_proxy_ca_paths();
    let runtime_plan = sample_runtime_plan();
    let startup_input = sample_startup_input();
    let supervisor_handle = SandboxdSupervisorHandle::new(
        "sandbox-123",
        Arc::new(SystemClock),
        BTreeSet::from([SupervisedComponent::EgressProxy]),
    );

    let proxy = EgressProxy::start_with_options(
        &runtime_plan,
        &startup_input,
        test_forwarding_mode(),
        listener_address,
        test_proxy_ca_config(&proxy_ca_paths),
        Arc::new(SystemClock),
        supervisor_handle,
    )
    .expect("egress proxy start should succeed")
    .expect("egress proxy should be configured");

    assert_eq!(
        fs::read(&proxy_ca_paths.runtime_certificate_path)
            .expect("runtime proxy CA certificate should exist"),
        fs::read(&proxy_ca_paths.trust_store_certificate_path)
            .expect("trust store proxy CA certificate should exist")
    );
    let runtime_certificate = fs::read_to_string(&proxy_ca_paths.runtime_certificate_path)
        .expect("runtime proxy CA certificate should be readable");
    let runtime_certificate_bundle =
        fs::read_to_string(&proxy_ca_paths.runtime_certificate_bundle_path)
            .expect("runtime proxy CA bundle should exist");
    assert!(
        runtime_certificate_bundle.starts_with("system-root\n"),
        "runtime proxy CA bundle should preserve system roots"
    );
    assert!(
        runtime_certificate_bundle.ends_with(&runtime_certificate),
        "runtime proxy CA bundle should append the local proxy CA"
    );
    assert_eq!(
        count_refresh_events(&proxy_ca_paths.refresh_marker_path),
        1,
        "startup should refresh the trust store once"
    );
    let persistent_certificate = fs::read_to_string(&proxy_ca_paths.persistent_certificate_path)
        .expect("persistent proxy CA certificate should exist");
    let persistent_private_key = fs::read_to_string(&proxy_ca_paths.persistent_private_key_path)
        .expect("persistent proxy CA private key should exist");
    assert_eq!(persistent_certificate, runtime_certificate);
    assert!(
        persistent_private_key.contains("BEGIN PRIVATE KEY"),
        "persistent proxy CA private key should contain a PEM private key"
    );

    proxy.close().expect("egress proxy close should succeed");

    assert!(
        !proxy_ca_paths.runtime_certificate_path.exists(),
        "runtime proxy CA certificate should be removed during cleanup"
    );
    assert!(
        !proxy_ca_paths.runtime_certificate_bundle_path.exists(),
        "runtime proxy CA bundle should be removed during cleanup"
    );
    assert!(
        proxy_ca_paths.trust_store_certificate_path.exists(),
        "trust store proxy CA certificate should remain installed after proxy close"
    );
    assert!(
        proxy_ca_paths.persistent_certificate_path.exists(),
        "persistent proxy CA certificate should remain after proxy close"
    );
    assert!(
        proxy_ca_paths.persistent_private_key_path.exists(),
        "persistent proxy CA private key should remain after proxy close"
    );
    assert_eq!(
        count_refresh_events(&proxy_ca_paths.refresh_marker_path),
        1,
        "cleanup should not refresh the trust store because the CA remains installed"
    );

    let _ = fs::remove_dir_all(&proxy_ca_paths.root_directory);
}

#[test]
fn reuses_existing_persistent_proxy_ca_when_egress_proxy_starts_again() {
    let proxy_ca_paths = test_proxy_ca_paths();
    let runtime_plan = sample_runtime_plan();
    let startup_input = sample_startup_input();
    let supervisor_handle = SandboxdSupervisorHandle::new(
        "sandbox-123",
        Arc::new(SystemClock),
        BTreeSet::from([SupervisedComponent::EgressProxy]),
    );

    let first_proxy = EgressProxy::start_with_options(
        &runtime_plan,
        &startup_input,
        test_forwarding_mode(),
        reserve_test_listener_address(),
        test_proxy_ca_config(&proxy_ca_paths),
        Arc::new(SystemClock),
        supervisor_handle.clone(),
    )
    .expect("first egress proxy start should succeed")
    .expect("first egress proxy should be configured");
    let first_persistent_certificate =
        fs::read_to_string(&proxy_ca_paths.persistent_certificate_path)
            .expect("first persistent proxy CA certificate should exist");
    let first_persistent_private_key =
        fs::read_to_string(&proxy_ca_paths.persistent_private_key_path)
            .expect("first persistent proxy CA private key should exist");
    first_proxy
        .close()
        .expect("first egress proxy close should succeed");

    let second_proxy = EgressProxy::start_with_options(
        &runtime_plan,
        &startup_input,
        test_forwarding_mode(),
        reserve_test_listener_address(),
        test_proxy_ca_config(&proxy_ca_paths),
        Arc::new(SystemClock),
        supervisor_handle,
    )
    .expect("second egress proxy start should succeed")
    .expect("second egress proxy should be configured");

    assert_eq!(
        fs::read_to_string(&proxy_ca_paths.persistent_certificate_path)
            .expect("second persistent proxy CA certificate should exist"),
        first_persistent_certificate
    );
    assert_eq!(
        fs::read_to_string(&proxy_ca_paths.persistent_private_key_path)
            .expect("second persistent proxy CA private key should exist"),
        first_persistent_private_key
    );
    assert_eq!(
        fs::read_to_string(&proxy_ca_paths.runtime_certificate_path)
            .expect("runtime proxy CA certificate should be reinstalled"),
        first_persistent_certificate
    );
    assert_eq!(
        count_refresh_events(&proxy_ca_paths.refresh_marker_path),
        2,
        "each proxy start should refresh the trust store with stable CA material"
    );

    second_proxy
        .close()
        .expect("second egress proxy close should succeed");
    let _ = fs::remove_dir_all(&proxy_ca_paths.root_directory);
}

#[test]
fn fails_when_persistent_proxy_ca_state_is_partial() {
    let proxy_ca_paths = test_proxy_ca_paths();
    fs::create_dir_all(
        proxy_ca_paths
            .persistent_certificate_path
            .parent()
            .expect("persistent proxy CA certificate path should have a parent"),
    )
    .expect("persistent proxy CA directory should be creatable");
    fs::write(&proxy_ca_paths.persistent_certificate_path, "certificate")
        .expect("partial persistent proxy CA certificate should be writable");
    let runtime_plan = sample_runtime_plan();
    let startup_input = sample_startup_input();
    let supervisor_handle = SandboxdSupervisorHandle::new(
        "sandbox-123",
        Arc::new(SystemClock),
        BTreeSet::from([SupervisedComponent::EgressProxy]),
    );

    let error = EgressProxy::start_with_options(
        &runtime_plan,
        &startup_input,
        test_forwarding_mode(),
        reserve_test_listener_address(),
        test_proxy_ca_config(&proxy_ca_paths),
        Arc::new(SystemClock),
        supervisor_handle,
    )
    .expect_err("egress proxy start should fail when persistent CA state is partial");

    assert!(
        error.to_string().contains("certificate exists")
            && error.to_string().contains("private key is missing"),
        "partial persistent CA state should be reported explicitly: {error}"
    );
    assert!(
        !proxy_ca_paths.persistent_private_key_path.exists(),
        "partial persistent CA state should not be repaired by regenerating a private key"
    );

    let _ = fs::remove_dir_all(&proxy_ca_paths.root_directory);
}

fn reserve_test_listener_address() -> SocketAddr {
    let listener = StdTcpListener::bind(("127.0.0.1", 0))
        .expect("test listener should bind to an ephemeral loopback port");
    let listener_address = listener
        .local_addr()
        .expect("test listener should expose its bound address");
    drop(listener);
    listener_address
}

fn start_single_request_http_server(
    response_body: &'static str,
) -> (SocketAddr, Receiver<String>, thread::JoinHandle<()>) {
    let listener = StdTcpListener::bind(("127.0.0.1", 0))
        .expect("test upstream server should bind to an ephemeral loopback port");
    let listener_address = listener
        .local_addr()
        .expect("test upstream server should expose its bound address");
    let (request_sender, request_receiver) = std::sync::mpsc::channel();
    let server_thread = thread::spawn(move || {
        let (mut stream, _) = listener
            .accept()
            .expect("test upstream server should accept one request");
        let mut request_bytes = Vec::new();
        let mut buffer = [0_u8; 1024];
        loop {
            let read_count = stream
                .read(&mut buffer)
                .expect("test upstream server should read request bytes");
            if read_count == 0 {
                break;
            }
            request_bytes.extend_from_slice(&buffer[..read_count]);
            if request_bytes.windows(4).any(|window| window == b"\r\n\r\n") {
                break;
            }
        }
        let request_text = String::from_utf8(request_bytes).expect("test request should be UTF-8");
        request_sender
            .send(request_text)
            .expect("test upstream request should be recorded");
        write!(
            stream,
            "HTTP/1.1 200 OK\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{}",
            response_body.len(),
            response_body
        )
        .expect("test upstream server should write response");
    });
    (listener_address, request_receiver, server_thread)
}

fn start_single_request_websocket_server() -> (SocketAddr, Receiver<String>, thread::JoinHandle<()>)
{
    let listener = StdTcpListener::bind(("127.0.0.1", 0))
        .expect("test websocket server should bind to an ephemeral loopback port");
    let listener_address = listener
        .local_addr()
        .expect("test websocket server should expose its bound address");
    let (request_sender, request_receiver) = std::sync::mpsc::channel();
    let server_thread = thread::spawn(move || {
        let (mut stream, _) = listener
            .accept()
            .expect("test websocket server should accept one request");
        let request_text = read_http_headers_from_stream(&mut stream);
        let websocket_key = request_text
            .lines()
            .find_map(|line| {
                let (name, value) = line.split_once(':')?;
                if name.eq_ignore_ascii_case("sec-websocket-key") {
                    Some(value.trim().to_string())
                } else {
                    None
                }
            })
            .expect("websocket request should include Sec-WebSocket-Key");
        let accept_key = derive_accept_key(websocket_key.as_bytes());
        request_sender
            .send(request_text)
            .expect("test websocket upstream request should be recorded");
        write!(
            stream,
            "HTTP/1.1 101 Switching Protocols\r\nconnection: upgrade\r\nupgrade: websocket\r\nsec-websocket-accept: {accept_key}\r\n\r\n"
        )
        .expect("test websocket server should write handshake response");
    });
    (listener_address, request_receiver, server_thread)
}

fn read_http_headers_from_stream(stream: &mut std::net::TcpStream) -> String {
    let mut request_bytes = Vec::new();
    let mut buffer = [0_u8; 1024];
    loop {
        let read_count = stream
            .read(&mut buffer)
            .expect("test server should read request bytes");
        if read_count == 0 {
            break;
        }
        request_bytes.extend_from_slice(&buffer[..read_count]);
        if request_bytes.windows(4).any(|window| window == b"\r\n\r\n") {
            break;
        }
    }
    String::from_utf8(request_bytes).expect("test request should be UTF-8")
}

fn send_proxy_http_request(proxy_address: SocketAddr, target_url: &str) -> String {
    let parsed_target = Url::parse(target_url).expect("test target URL should parse");
    let host = parsed_target
        .host_str()
        .expect("test target URL should include a host");
    let authority = if let Some(port) = parsed_target.port() {
        format!("{host}:{port}")
    } else {
        host.to_string()
    };
    let mut stream =
        std::net::TcpStream::connect(proxy_address).expect("test should connect to proxy");
    write!(
        stream,
        "GET {target_url} HTTP/1.1\r\nhost: {authority}\r\nconnection: close\r\n\r\n"
    )
    .expect("test should write proxy request");

    let mut response = String::new();
    stream
        .read_to_string(&mut response)
        .expect("test should read proxy response");
    response
}

fn send_proxy_websocket_handshake(proxy_address: SocketAddr, target_url: &str) -> String {
    let parsed_target = Url::parse(target_url).expect("test target URL should parse");
    let host = parsed_target
        .host_str()
        .expect("test target URL should include a host");
    let authority = if let Some(port) = parsed_target.port() {
        format!("{host}:{port}")
    } else {
        host.to_string()
    };
    let mut stream =
        std::net::TcpStream::connect(proxy_address).expect("test should connect to proxy");
    write!(
        stream,
        "GET {target_url} HTTP/1.1\r\nhost: {authority}\r\nconnection: upgrade\r\nupgrade: websocket\r\nsec-websocket-key: dGhlIHNhbXBsZSBub25jZQ==\r\nsec-websocket-version: 13\r\n\r\n"
    )
    .expect("test should write proxy websocket handshake");

    read_http_headers_from_stream(&mut stream)
}

fn sample_runtime_plan() -> CompiledRuntimePlan {
    CompiledRuntimePlan {
        image: crate::runtime::CompiledRuntimePlanImage {
            source: crate::runtime::CompiledRuntimePlanImageSource::Base,
            image_ref: "registry.example.test/base:latest".to_string(),
        },
        setup_script: None,
        egress_routes: vec![CompiledEgressRoute {
            egress_rule_id: "egress-rule-1".to_string(),
            binding_id: "binding-1".to_string(),
            family_id: "family-1".to_string(),
            variant_id: "variant-1".to_string(),
            r#match: CompiledEgressRouteMatch {
                hosts: vec!["api.openai.com".to_string()],
                path_prefixes: Some(vec!["/v1".to_string()]),
                methods: Some(vec!["POST".to_string()]),
            },
            upstream: CompiledEgressRouteUpstream {
                base_url: "https://api.openai.com".to_string(),
            },
            auth_injection: CompiledEgressRouteAuthInjection {
                r#type: CompiledEgressRouteAuthInjectionType::Bearer,
                target: None,
                username: None,
                service: None,
                region: None,
            },
            additional_headers: None,
            additional_credential_headers: None,
            credential_resolver: CompiledEgressRouteCredentialResolver::IntegrationConnection {
                connection_id: "connection-1".to_string(),
                secret_type: "token".to_string(),
                slot_key: None,
                resolver_key: None,
            },
            request_middleware: None,
        }],
        artifacts: Vec::new(),
        workspace_sources: Vec::new(),
        runtime_clients: Vec::new(),
        agent_runtimes: Vec::new(),
    }
}

fn sample_startup_input() -> StartupInput {
    StartupInput {
        startup_mode: StartupMode::New,
        operation_kind: crate::protocol::startup::StartupOperationKind::Start,
        execution_mode: crate::protocol::startup::StartupExecutionMode::Session,
        bootstrap_token: "bootstrap-token".to_string(),
        tunnel_exchange_token: "exchange-token".to_string(),
        tunnel_gateway_ws_url: "ws://127.0.0.1:4500/tunnel/sandbox/sandbox-123".to_string(),
        acting_user_id: None,
        runtime_plan: serde_json::json!({}),
        git_identity: None,
        transparent_proxy: None,
    }
}

fn test_forwarding_mode() -> EgressProxyForwardingMode {
    EgressProxyForwardingMode::DirectGateway {
        client: Arc::new(DirectGatewayEgressClient {
            http_route_url: resolve_direct_gateway_route_url(
                "ws://127.0.0.1:4500/tunnel/sandbox/sandbox-123",
                DIRECT_EGRESS_HTTP_ROUTE_PATH,
                DirectGatewayRouteScheme::Http,
            )
            .expect("direct gateway HTTP route URL should resolve"),
            websocket_route_url: resolve_direct_gateway_route_url(
                "ws://127.0.0.1:4500/tunnel/sandbox/sandbox-123",
                DIRECT_EGRESS_WEBSOCKET_ROUTE_PATH,
                DirectGatewayRouteScheme::WebSocket,
            )
            .expect("direct gateway websocket route URL should resolve"),
            token_provider: GatewayEgressTokenProvider::new("sandbox-123"),
        }),
    }
}

fn test_proxy_ca_paths() -> TestProxyCaPaths {
    let unique_id = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time should be after unix epoch")
        .as_nanos();
    let counter = TEST_PROXY_CA_PATH_COUNTER.fetch_add(1, Ordering::Relaxed);
    let process_id = std::process::id();
    let root_directory = std::env::temp_dir().join(format!(
        "mistle-egress-proxy-test-{process_id}-{unique_id}-{counter}"
    ));
    let system_certificate_bundle_path = root_directory.join("etc/ssl/certs/ca-certificates.crt");
    let runtime_certificate_path = root_directory.join("run/mistle/sandboxd/egress-proxy-ca.pem");
    let runtime_certificate_bundle_path =
        root_directory.join("run/mistle/sandboxd/egress-proxy-ca-bundle.pem");
    let persistent_certificate_path =
        root_directory.join("var/lib/mistle/sandboxd/egress-proxy-ca.pem");
    let persistent_private_key_path =
        root_directory.join("var/lib/mistle/sandboxd/egress-proxy-ca-key.pem");
    let trust_store_certificate_path =
        root_directory.join("usr/local/share/ca-certificates/mistle-egress-proxy-ca.crt");
    let refresh_marker_path = root_directory.join("update-ca-certificates.log");
    let refresh_command_path = root_directory.join("bin/update-ca-certificates");
    fs::create_dir_all(
        system_certificate_bundle_path
            .parent()
            .expect("system certificate bundle path should have a parent directory"),
    )
    .expect("system certificate bundle directory should be creatable");
    fs::write(&system_certificate_bundle_path, "system-root\n")
        .expect("system certificate bundle should be writable");
    fs::create_dir_all(
        refresh_command_path
            .parent()
            .expect("refresh command path should have a parent directory"),
    )
    .expect("refresh command directory should be creatable");
    fs::write(
        &refresh_command_path,
        format!(
            "#!/bin/sh\nprintf 'refresh\\n' >> '{}'\n",
            refresh_marker_path.display()
        ),
    )
    .expect("refresh command script should be writable");
    let mut permissions = fs::metadata(&refresh_command_path)
        .expect("refresh command metadata should be readable")
        .permissions();
    permissions.set_mode(0o755);
    fs::set_permissions(&refresh_command_path, permissions)
        .expect("refresh command should be executable");

    TestProxyCaPaths {
        root_directory,
        system_certificate_bundle_path,
        runtime_certificate_path,
        runtime_certificate_bundle_path,
        persistent_certificate_path,
        persistent_private_key_path,
        trust_store_certificate_path,
        refresh_command_path,
        refresh_marker_path,
    }
}

fn test_proxy_ca_config(proxy_ca_paths: &TestProxyCaPaths) -> ProxyCaConfig<'_> {
    ProxyCaConfig {
        runtime_certificate_path: &proxy_ca_paths.runtime_certificate_path,
        runtime_certificate_bundle_path: &proxy_ca_paths.runtime_certificate_bundle_path,
        persistent_certificate_path: &proxy_ca_paths.persistent_certificate_path,
        persistent_private_key_path: &proxy_ca_paths.persistent_private_key_path,
        trust_store_certificate_path: &proxy_ca_paths.trust_store_certificate_path,
        system_certificate_bundle_path: &proxy_ca_paths.system_certificate_bundle_path,
        refresh_command: &proxy_ca_paths.refresh_command_path,
    }
}

fn count_refresh_events(marker_path: &std::path::Path) -> usize {
    fs::read_to_string(marker_path)
        .unwrap_or_default()
        .lines()
        .count()
}

fn wait_for_egress_snapshot(
    supervisor_handle: &SandboxdSupervisorHandle,
    expected_state: ComponentHealthState,
    expected_restart_count: u64,
    timeout: Duration,
) {
    let deadline = Instant::now() + timeout;
    loop {
        let snapshot = supervisor_handle
            .component_snapshot(SupervisedComponent::EgressProxy)
            .expect("egress proxy should be tracked");
        if snapshot.state == expected_state && snapshot.restart_count >= expected_restart_count {
            return;
        }
        assert!(
            Instant::now() < deadline,
            "expected egress proxy snapshot to reach state {expected_state:?} with restart_count >= {expected_restart_count}, got {snapshot:?}"
        );
        thread::sleep(Duration::from_millis(25));
    }
}
