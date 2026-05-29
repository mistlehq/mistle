//! Request-target resolution and compiled route matching for egress proxying.
//!
//! The server asks this module to normalize each HTTP request into a target and
//! select the matching runtime-plan egress route before any upstream connection
//! is opened.

use hyper::Uri;
use hyper::header::HOST;

use crate::egress_proxy::{EgressProxyError, EgressProxyState};
use crate::runtime::CompiledEgressRoute;

#[derive(Debug, Clone)]
pub(super) struct EgressProxyRoute {
    pub(super) egress_rule_id: String,
    pub(super) hosts: Vec<String>,
    pub(super) path_prefixes: Vec<String>,
    pub(super) methods: Option<Vec<String>>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct RequestTarget {
    pub(super) authority: String,
    pub(super) host: String,
    pub(super) uri: Uri,
}

#[derive(Clone)]
pub(super) struct RequestTargetOverride {
    pub(super) scheme: &'static str,
    pub(super) default_authority: String,
}

pub(super) fn build_gateway_egress_route(
    route: &CompiledEgressRoute,
) -> Result<EgressProxyRoute, EgressProxyError> {
    let upstream_url = url::Url::parse(&route.upstream.base_url).map_err(|error| {
        EgressProxyError::new(format!(
            "runtime plan egress route '{}' has invalid upstream base url '{}': {error}",
            route.egress_rule_id, route.upstream.base_url
        ))
    })?;
    if upstream_url.host_str().is_none() {
        return Err(EgressProxyError::new(format!(
            "runtime plan egress route '{}' upstream '{}' must include a host",
            route.egress_rule_id, route.upstream.base_url
        )));
    }
    if route.r#match.hosts.is_empty() {
        return Err(EgressProxyError::new(format!(
            "runtime plan egress route '{}' must include at least one match host",
            route.egress_rule_id
        )));
    }

    Ok(EgressProxyRoute {
        egress_rule_id: route.egress_rule_id.clone(),
        hosts: route
            .r#match
            .hosts
            .iter()
            .map(|host| normalize_match_host(host))
            .collect(),
        path_prefixes: route
            .r#match
            .path_prefixes
            .clone()
            .unwrap_or_else(|| vec!["/".to_string()]),
        methods: route.r#match.methods.clone().map(|methods| {
            methods
                .into_iter()
                .map(|method| method.to_ascii_uppercase())
                .collect()
        }),
    })
}

pub(super) fn resolve_request_target(
    request: &hyper::http::request::Parts,
    target_override: Option<&RequestTargetOverride>,
) -> Result<RequestTarget, EgressProxyError> {
    let authority = if let Some(authority) = request.uri.authority() {
        authority.as_str().to_string()
    } else if let Some(host) = request.headers.get(HOST) {
        host.to_str()
            .map(|value| value.to_string())
            .map_err(|error| {
                EgressProxyError::new(format!("proxied request host header is invalid: {error}"))
            })?
    } else if let Some(target_override) = target_override {
        target_override.default_authority.clone()
    } else {
        return Err(EgressProxyError::new("proxied request is missing a host"));
    };
    let scheme = target_override.map_or_else(
        || request.uri.scheme_str().unwrap_or("http"),
        |target_override| target_override.scheme,
    );
    let uri = match (
        request.uri.scheme(),
        request.uri.authority(),
        target_override,
    ) {
        (Some(_), Some(_), None) => request.uri.clone(),
        (Some(_), Some(_), Some(_)) => request.uri.clone(),
        _ => build_direct_forward_uri(scheme, &authority, request.uri.path_and_query())?,
    };

    Ok(RequestTarget {
        host: normalize_authority_host(&authority),
        authority,
        uri,
    })
}

pub(super) fn build_direct_forward_uri(
    scheme: &str,
    authority: &str,
    path_and_query: Option<&hyper::http::uri::PathAndQuery>,
) -> Result<Uri, EgressProxyError> {
    let path_and_query = path_and_query.map_or("/", |path_and_query| path_and_query.as_str());

    format!("{scheme}://{authority}{path_and_query}")
        .parse()
        .map_err(|error| {
            EgressProxyError::new(format!(
                "failed to build direct forward uri for '{scheme}://{authority}{path_and_query}': {error}"
            ))
        })
}

pub(super) fn match_state_route(
    state: &EgressProxyState,
    host: &str,
    path: &str,
    method: &str,
) -> Result<Option<EgressProxyRoute>, EgressProxyError> {
    let routes = state
        .routes
        .read()
        .map_err(|_| EgressProxyError::new("egress proxy route table lock is poisoned"))?;
    match_route(&routes, host, path, method).map(|route| route.cloned())
}

pub(super) fn match_route<'a>(
    routes: &'a [EgressProxyRoute],
    host: &str,
    path: &str,
    method: &str,
) -> Result<Option<&'a EgressProxyRoute>, EgressProxyError> {
    let normalized_host = normalize_authority_host(host);
    let matching_routes = routes
        .iter()
        .filter(|route| {
            route
                .hosts
                .iter()
                .any(|route_host| route_host == &normalized_host)
                && route
                    .path_prefixes
                    .iter()
                    .any(|path_prefix| path_belongs_to_prefix(path, path_prefix))
                && route
                    .methods
                    .as_ref()
                    .is_none_or(|methods| methods.iter().any(|route_method| route_method == method))
        })
        .collect::<Vec<_>>();

    match matching_routes.as_slice() {
        [] => Ok(None),
        [route] => Ok(Some(*route)),
        _ => Err(EgressProxyError::new(format!(
            "multiple sandbox egress routes matched proxied request {method} {host}{path}"
        ))),
    }
}

fn path_belongs_to_prefix(path: &str, path_prefix: &str) -> bool {
    let normalized_path;
    let path = if path.starts_with('/') {
        path
    } else {
        normalized_path = format!("/{path}");
        &normalized_path
    };
    let path = path.split_once('?').map_or(path, |(path, _)| path);
    let normalized_path_prefix = normalize_path_prefix(path_prefix);

    normalized_path_prefix == "/"
        || path == normalized_path_prefix
        || path.starts_with(&format!("{normalized_path_prefix}/"))
}

fn normalize_path_prefix(path_prefix: &str) -> &str {
    let trimmed_path_prefix = path_prefix.trim();
    if trimmed_path_prefix == "/" {
        return "/";
    }
    trimmed_path_prefix
        .strip_suffix('/')
        .unwrap_or(trimmed_path_prefix)
}

fn normalize_authority_host(authority: &str) -> String {
    let normalized_authority = authority.trim().to_ascii_lowercase();
    normalized_authority
        .strip_prefix('[')
        .and_then(|authority| authority.split_once(']'))
        .map_or_else(
            || {
                normalized_authority.split_once(':').map_or_else(
                    || normalized_authority.to_string(),
                    |(host, _)| host.to_string(),
                )
            },
            |(host, _)| host.to_string(),
        )
}

fn normalize_match_host(host: &str) -> String {
    let normalized_host = host.trim().to_ascii_lowercase();
    if let Some((host, _)) = normalized_host
        .strip_prefix('[')
        .and_then(|host| host.split_once(']'))
    {
        return host.to_string();
    }
    normalized_host
}
