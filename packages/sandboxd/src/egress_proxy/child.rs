//! Child-process entrypoint for the sandbox-local egress proxy.
//!
//! The parent `sandboxd` process owns sandbox lifecycle, nftables, and network
//! monitoring. This entrypoint keeps the forward-proxy runtime in a separate
//! process boundary so proxy stalls do not block the supervisor daemon.

use std::fs;
use std::io::Read;
use std::net::SocketAddr;
use std::os::fd::{FromRawFd, RawFd};
use std::path::Path;
use std::sync::Arc;
use std::sync::RwLock;
use std::sync::atomic::AtomicU64;

use serde::{Deserialize, Serialize};
use tokio::sync::oneshot;

use crate::egress_proxy::gateway::{DirectGatewayEgressClient, EgressProxyForwardingMode};
use crate::egress_proxy::routing::EgressProxyRoute;
use crate::egress_proxy::server::run_proxy_server;
use crate::egress_proxy::supervisor::bind_egress_proxy_listener;
use crate::egress_proxy::token_bridge::EgressTokenBridgeClient;
use crate::egress_proxy::{EgressProxyError, EgressProxyState};
use crate::time::SystemClock;
use crate::tunnel::session::GatewayEgressTokenProvider;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct EgressProxyChildConfig {
    pub(super) sandbox_instance_id: String,
    pub(super) listen_addr: SocketAddr,
    pub(super) tunnel_gateway_ws_url: String,
    pub(super) token_bridge_fd: Option<i32>,
    pub(super) routes: Vec<EgressProxyChildRoute>,
    pub(super) proxy_ca_certificate_fd: RawFd,
    pub(super) proxy_ca_private_key_fd: RawFd,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct EgressProxyChildRoute {
    pub(super) egress_rule_id: String,
    pub(super) hosts: Vec<String>,
    pub(super) path_prefixes: Vec<String>,
    pub(super) methods: Option<Vec<String>>,
}

pub(super) fn run_egress_proxy_child(config_path: &Path) -> Result<(), EgressProxyError> {
    let config = read_egress_proxy_child_config(config_path)?;
    let listener = bind_egress_proxy_listener(config.listen_addr).map_err(EgressProxyError::new)?;
    let state = build_child_proxy_state(config)?;
    let (_shutdown_tx, shutdown_rx) = oneshot::channel();

    run_proxy_server(listener, shutdown_rx, state)
}

fn read_egress_proxy_child_config(
    config_path: &Path,
) -> Result<EgressProxyChildConfig, EgressProxyError> {
    let config_json = fs::read_to_string(config_path).map_err(|error| {
        EgressProxyError::new(format!(
            "failed to read egress proxy child config '{}': {error}",
            config_path.display()
        ))
    })?;
    serde_json::from_str(&config_json).map_err(|error| {
        EgressProxyError::new(format!(
            "failed to parse egress proxy child config '{}': {error}",
            config_path.display()
        ))
    })
}

fn build_child_proxy_state(
    config: EgressProxyChildConfig,
) -> Result<EgressProxyState, EgressProxyError> {
    let client = match config.token_bridge_fd {
        Some(fd) => DirectGatewayEgressClient::from_child_token_bridge(
            &config.tunnel_gateway_ws_url,
            EgressTokenBridgeClient::from_inherited_fd(fd)?,
        )?,
        None => DirectGatewayEgressClient::from_bootstrap_tunnel_url(
            &config.tunnel_gateway_ws_url,
            GatewayEgressTokenProvider::new(config.sandbox_instance_id.clone(), None),
        )?,
    };
    let forwarding_mode = EgressProxyForwardingMode::DirectGateway {
        client: Arc::new(client),
    };

    Ok(EgressProxyState {
        sandbox_instance_id: config.sandbox_instance_id,
        forwarding_mode,
        routes: Arc::new(RwLock::new(
            config.routes.into_iter().map(Into::into).collect(),
        )),
        proxy_ca_certificate_pem: Arc::new(read_pem_from_inherited_fd(
            "proxy ca certificate",
            config.proxy_ca_certificate_fd,
        )?),
        proxy_ca_private_key_pem: Arc::new(read_pem_from_inherited_fd(
            "proxy ca private key",
            config.proxy_ca_private_key_fd,
        )?),
        clock: Arc::new(SystemClock),
        next_request_id: Arc::new(AtomicU64::new(1)),
    })
}

fn read_pem_from_inherited_fd(name: &str, fd: RawFd) -> Result<String, EgressProxyError> {
    if fd < 0 {
        return Err(EgressProxyError::new(format!(
            "{name} fd must be non-negative"
        )));
    }

    let mut file = unsafe { fs::File::from_raw_fd(fd) };
    let mut payload = String::new();
    file.read_to_string(&mut payload).map_err(|error| {
        EgressProxyError::new(format!("failed to read inherited {name} fd {fd}: {error}"))
    })?;
    if payload.trim().is_empty() {
        return Err(EgressProxyError::new(format!("{name} payload is empty")));
    }
    Ok(payload)
}

impl From<EgressProxyChildRoute> for EgressProxyRoute {
    fn from(route: EgressProxyChildRoute) -> Self {
        Self {
            egress_rule_id: route.egress_rule_id,
            hosts: route.hosts,
            path_prefixes: route.path_prefixes,
            methods: route.methods,
        }
    }
}

#[cfg(test)]
mod tests {
    use std::net::SocketAddr;

    use crate::egress_proxy::child::EgressProxyChildConfig;

    #[test]
    fn parses_child_config_with_routes() {
        let config: EgressProxyChildConfig = serde_json::from_value(serde_json::json!({
            "sandboxInstanceId": "sbi_child_config",
            "listenAddr": "127.0.0.1:38513",
            "tunnelGatewayWsUrl": "ws://127.0.0.1:5003/tunnel/sandbox/sbi_child_config",
            "tokenBridgeFd": 7,
            "routes": [
                {
                    "egressRuleId": "egr_123",
                    "hosts": ["api.example.test"],
                    "pathPrefixes": ["/v1"],
                    "methods": ["GET", "POST"]
                }
            ],
            "proxyCaCertificateFd": 8,
            "proxyCaPrivateKeyFd": 9
        }))
        .expect("child config should parse");

        assert_eq!(config.sandbox_instance_id, "sbi_child_config");
        assert_eq!(
            config.listen_addr,
            "127.0.0.1:38513"
                .parse::<SocketAddr>()
                .expect("socket addr should parse")
        );
        assert_eq!(config.routes.len(), 1);
        assert_eq!(config.token_bridge_fd, Some(7));
        assert_eq!(config.proxy_ca_certificate_fd, 8);
        assert_eq!(config.proxy_ca_private_key_fd, 9);
        assert_eq!(config.routes[0].egress_rule_id, "egr_123");
    }
}
