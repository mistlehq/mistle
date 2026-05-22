//! Direct data-plane gateway client for approved egress requests.
//!
//! Route matching decides whether a request can leave the sandbox; this module
//! builds the data-plane direct-egress URLs and websocket targets used once a
//! route has selected gateway forwarding.

use std::sync::Arc;

use hyper::Uri;
use url::Url;

use crate::egress_proxy::tls::websocket_target_url;
use crate::egress_proxy::token_bridge::EgressTokenBridgeClient;
use crate::egress_proxy::{
    DIRECT_EGRESS_HTTP_ROUTE_PATH, DIRECT_EGRESS_WEBSOCKET_ROUTE_PATH, EgressProxyError,
};
use crate::tunnel::session::GatewayEgressTokenProvider;

#[derive(Clone)]
pub(super) enum EgressProxyForwardingMode {
    DirectGateway {
        client: Arc<DirectGatewayEgressClient>,
    },
}

#[derive(Clone)]
pub(super) struct DirectGatewayEgressClient {
    pub(super) http_route_url: Url,
    pub(super) websocket_route_url: Url,
    pub(super) token_provider: DirectGatewayEgressTokenProvider,
}

#[derive(Clone)]
pub(super) enum DirectGatewayEgressTokenProvider {
    Local(GatewayEgressTokenProvider),
    Bridge(EgressTokenBridgeClient),
}

#[derive(Clone, Copy)]
pub(super) enum DirectGatewayRouteScheme {
    Http,
    WebSocket,
}

impl DirectGatewayEgressClient {
    pub(super) fn from_bootstrap_tunnel_url(
        tunnel_gateway_ws_url: &str,
        token_provider: GatewayEgressTokenProvider,
    ) -> Result<Self, EgressProxyError> {
        Ok(Self {
            http_route_url: resolve_direct_gateway_route_url(
                tunnel_gateway_ws_url,
                DIRECT_EGRESS_HTTP_ROUTE_PATH,
                DirectGatewayRouteScheme::Http,
            )?,
            websocket_route_url: resolve_direct_gateway_route_url(
                tunnel_gateway_ws_url,
                DIRECT_EGRESS_WEBSOCKET_ROUTE_PATH,
                DirectGatewayRouteScheme::WebSocket,
            )?,
            token_provider: DirectGatewayEgressTokenProvider::Local(token_provider),
        })
    }

    pub(super) fn from_child_token_bridge(
        tunnel_gateway_ws_url: &str,
        token_bridge: EgressTokenBridgeClient,
    ) -> Result<Self, EgressProxyError> {
        Ok(Self {
            http_route_url: resolve_direct_gateway_route_url(
                tunnel_gateway_ws_url,
                DIRECT_EGRESS_HTTP_ROUTE_PATH,
                DirectGatewayRouteScheme::Http,
            )?,
            websocket_route_url: resolve_direct_gateway_route_url(
                tunnel_gateway_ws_url,
                DIRECT_EGRESS_WEBSOCKET_ROUTE_PATH,
                DirectGatewayRouteScheme::WebSocket,
            )?,
            token_provider: DirectGatewayEgressTokenProvider::Bridge(token_bridge),
        })
    }

    pub(super) async fn token(&self) -> Result<String, EgressProxyError> {
        let token_provider = self.token_provider.clone();
        let token = tokio::task::spawn_blocking(move || token_provider.token())
            .await
            .map_err(|error| {
                EgressProxyError::new(format!("gateway egress token task failed: {error}"))
            })?
            .map_err(|error| EgressProxyError::new(error.to_string()))?;
        Ok(token.token)
    }

    pub(super) fn direct_http_url(&self, target_url: &Uri) -> Result<Uri, EgressProxyError> {
        let mut route_url = self.http_route_url.clone();
        route_url
            .query_pairs_mut()
            .append_pair("target", &target_url.to_string());
        route_url.as_str().parse().map_err(|error| {
            EgressProxyError::new(format!(
                "failed to build direct gateway egress HTTP URL: {error}"
            ))
        })
    }

    pub(super) fn direct_websocket_url(
        &self,
        target_url: &Uri,
    ) -> Result<String, EgressProxyError> {
        let mut route_url = self.websocket_route_url.clone();
        route_url
            .query_pairs_mut()
            .append_pair("target", &websocket_target_url(target_url)?);
        Ok(route_url.to_string())
    }
}

impl DirectGatewayEgressTokenProvider {
    fn token(&self) -> Result<crate::tunnel::session::TunnelEgressToken, EgressProxyError> {
        match self {
            Self::Local(provider) => provider
                .token()
                .map_err(|error| EgressProxyError::new(error.to_string())),
            Self::Bridge(provider) => provider.token(),
        }
    }
}

pub(super) fn resolve_direct_gateway_route_url(
    tunnel_gateway_ws_url: &str,
    route_path: &str,
    route_scheme: DirectGatewayRouteScheme,
) -> Result<Url, EgressProxyError> {
    let mut route_url = Url::parse(tunnel_gateway_ws_url).map_err(|error| {
        EgressProxyError::new(format!(
            "failed to parse sandbox tunnel gateway ws url for direct egress: {error}"
        ))
    })?;
    route_url
        .set_scheme(match (route_url.scheme(), route_scheme) {
            ("ws", DirectGatewayRouteScheme::Http) => "http",
            ("wss", DirectGatewayRouteScheme::Http) => "https",
            ("ws", DirectGatewayRouteScheme::WebSocket) => "ws",
            ("wss", DirectGatewayRouteScheme::WebSocket) => "wss",
            (scheme, _) => {
                return Err(EgressProxyError::new(format!(
                    "sandbox tunnel gateway ws url must use ws or wss scheme, got '{scheme}'"
                )));
            }
        })
        .map_err(|_| {
            EgressProxyError::new(
                "failed to set direct gateway egress route URL scheme".to_string(),
            )
        })?;
    route_url.set_path(route_path);
    Ok(route_url)
}
