//! Sandbox-local egress proxy for runtime tools and interactive shells.
//!
//! Runtime tools like `gh` and `git` expect standard `HTTP[S]_PROXY` semantics,
//! while tokenizer-proxy expects route-relative requests plus an egress grant.
//! This module bridges those models: it exposes one local forward proxy inside
//! the sandbox, terminates proxied HTTPS sessions with an ephemeral CA, matches
//! each decrypted request against the compiled runtime-plan egress routes, and
//! then forwards the request to tokenizer-proxy with the matching grant header.

use std::collections::BTreeMap;
use std::convert::Infallible;
use std::fmt::{self, Display};
use std::fs::{self, DirBuilder};
use std::net::{SocketAddr, TcpListener as StdTcpListener};
use std::os::unix::fs::DirBuilderExt;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::thread::{self, JoinHandle};

use bytes::Bytes;
use http_body_util::{BodyExt, Full};
use hyper::body::Incoming;
use hyper::header::{HOST, HeaderName, HeaderValue};
use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper::{Method, Request, Response, StatusCode, Uri};
use hyper_rustls::{HttpsConnector, HttpsConnectorBuilder};
use hyper_util::client::legacy::Client;
use hyper_util::client::legacy::connect::HttpConnector;
use hyper_util::rt::{TokioExecutor, TokioIo};
use rustls_pki_types::pem::PemObject;
use rustls_pki_types::{CertificateDer, PrivateKeyDer};
use tokio::net::TcpListener;
use tokio::runtime::Builder;
use tokio::sync::oneshot;
use tokio_rustls::TlsAcceptor;
use tokio_rustls::rustls::ServerConfig;

use crate::protocol::startup::StartupInput;
use crate::proxy_ca::{generate_proxy_ca, issue_proxy_leaf_certificate};
use crate::runtime::{CompiledEgressRoute, CompiledRuntimePlan};
use crate::time::Clock;

const TOKENIZER_PROXY_EGRESS_GRANT_HEADER_NAME: &str = "X-Mistle-Egress-Grant";
const RUNTIME_PROXY_DIRECTORY: &str = "/run/mistle/sandboxd";
const RUNTIME_PROXY_CA_CERT_PATH: &str = "/run/mistle/sandboxd/egress-proxy-ca.pem";
const LOOPBACK_PROXY_HOST: &str = "127.0.0.1";
const RUNTIME_NO_PROXY_DEFAULTS: [&str; 2] = ["127.0.0.1", "localhost"];

const MANAGED_PROXY_ENV_KEYS: [&str; 15] = [
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "ALL_PROXY",
    "NO_PROXY",
    "http_proxy",
    "https_proxy",
    "all_proxy",
    "no_proxy",
    "SSL_CERT_FILE",
    "CURL_CA_BUNDLE",
    "GIT_SSL_CAINFO",
    "REQUESTS_CA_BUNDLE",
    "NODE_EXTRA_CA_CERTS",
    "SSL_CERT_DIR",
    "GIT_SSL_CAPATH",
];

type HyperBody = Full<Bytes>;
type EgressConnector = HttpsConnector<HttpConnector>;

#[derive(Debug)]
pub struct EgressProxy {
    runtime_env: BTreeMap<String, String>,
    shutdown_tx: Option<oneshot::Sender<()>>,
    server_thread: Option<JoinHandle<Result<(), EgressProxyError>>>,
    ca_certificate_path: PathBuf,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EgressProxyError {
    message: String,
}

#[derive(Debug, Clone)]
struct EgressProxyRoute {
    upstream_base_url: String,
    host: String,
    path_prefixes: Vec<String>,
    methods: Option<Vec<String>>,
    grant: String,
}

#[derive(Clone)]
struct EgressProxyState {
    tokenizer_proxy_egress_base_url: String,
    routes: Arc<Vec<EgressProxyRoute>>,
    client: Client<EgressConnector, HyperBody>,
    proxy_ca_certificate_pem: Arc<String>,
    proxy_ca_private_key_pem: Arc<String>,
    clock: Arc<dyn Clock>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct RequestTarget {
    authority: String,
    host: String,
    uri: Uri,
}

impl EgressProxyError {
    fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }
}

impl Display for EgressProxyError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for EgressProxyError {}

impl EgressProxy {
    pub fn start(
        runtime_plan: &CompiledRuntimePlan,
        startup_input: &StartupInput,
        tokenizer_proxy_egress_base_url: &str,
        clock: Arc<dyn Clock>,
    ) -> Result<Option<Self>, EgressProxyError> {
        if runtime_plan.egress_routes.is_empty() {
            return Ok(None);
        }

        let routes = runtime_plan
            .egress_routes
            .iter()
            .map(|route| build_proxy_route(route, startup_input))
            .collect::<Result<Vec<_>, _>>()?;

        prepare_proxy_directory(Path::new(RUNTIME_PROXY_DIRECTORY))?;
        let generated_proxy_ca = generate_proxy_ca(clock.as_ref())
            .map_err(|error| EgressProxyError::new(error.to_string()))?;
        fs::write(
            RUNTIME_PROXY_CA_CERT_PATH,
            generated_proxy_ca.certificate_pem.as_bytes(),
        )
        .map_err(|error| {
            EgressProxyError::new(format!(
                "failed to write local egress proxy certificate '{RUNTIME_PROXY_CA_CERT_PATH}': {error}"
            ))
        })?;

        let std_listener = StdTcpListener::bind((LOOPBACK_PROXY_HOST, 0)).map_err(|error| {
            EgressProxyError::new(format!(
                "failed to bind local egress proxy listener: {error}"
            ))
        })?;
        std_listener.set_nonblocking(true).map_err(|error| {
            EgressProxyError::new(format!("failed to configure proxy listener: {error}"))
        })?;
        let listener_address = std_listener.local_addr().map_err(|error| {
            EgressProxyError::new(format!(
                "failed to inspect local egress proxy address: {error}"
            ))
        })?;

        let mut http_connector = HttpConnector::new();
        http_connector.enforce_http(false);
        let https_connector = HttpsConnectorBuilder::new()
            .with_native_roots()
            .map_err(|error| {
                EgressProxyError::new(format!(
                    "failed to load system certificate roots for local egress proxy: {error}"
                ))
            })?
            .https_or_http()
            .enable_http1()
            .wrap_connector(http_connector);
        let state = EgressProxyState {
            tokenizer_proxy_egress_base_url: tokenizer_proxy_egress_base_url.to_string(),
            routes: Arc::new(routes),
            client: Client::builder(TokioExecutor::new()).build(https_connector),
            proxy_ca_certificate_pem: Arc::new(generated_proxy_ca.certificate_pem.clone()),
            proxy_ca_private_key_pem: Arc::new(generated_proxy_ca.private_key_pem),
            clock,
        };

        let (shutdown_tx, shutdown_rx) = oneshot::channel();
        let server_thread =
            thread::spawn(move || run_proxy_server(std_listener, shutdown_rx, state));

        let runtime_env = build_managed_proxy_env(
            listener_address,
            Path::new(RUNTIME_PROXY_CA_CERT_PATH),
            tokenizer_proxy_egress_base_url,
        )?;

        Ok(Some(Self {
            runtime_env,
            shutdown_tx: Some(shutdown_tx),
            server_thread: Some(server_thread),
            ca_certificate_path: PathBuf::from(RUNTIME_PROXY_CA_CERT_PATH),
        }))
    }

    pub fn runtime_env(&self) -> &BTreeMap<String, String> {
        &self.runtime_env
    }

    pub fn managed_env_keys() -> &'static [&'static str] {
        &MANAGED_PROXY_ENV_KEYS
    }

    pub fn close(mut self) -> Result<(), EgressProxyError> {
        if let Some(shutdown_tx) = self.shutdown_tx.take() {
            let _ = shutdown_tx.send(());
        }

        if let Some(server_thread) = self.server_thread.take() {
            match server_thread.join() {
                Ok(Ok(())) => {}
                Ok(Err(error)) => return Err(error),
                Err(_) => return Err(EgressProxyError::new("local egress proxy thread panicked")),
            }
        }

        match fs::remove_file(&self.ca_certificate_path) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => {
                return Err(EgressProxyError::new(format!(
                    "failed to remove local egress proxy certificate '{}': {error}",
                    self.ca_certificate_path.display()
                )));
            }
        }

        Ok(())
    }
}

fn build_proxy_route(
    route: &CompiledEgressRoute,
    startup_input: &StartupInput,
) -> Result<EgressProxyRoute, EgressProxyError> {
    let upstream_url = url::Url::parse(&route.upstream.base_url).map_err(|error| {
        EgressProxyError::new(format!(
            "runtime plan egress route '{}' has invalid upstream base url '{}': {error}",
            route.egress_rule_id, route.upstream.base_url
        ))
    })?;
    let host = upstream_url.host_str().ok_or_else(|| {
        EgressProxyError::new(format!(
            "runtime plan egress route '{}' upstream '{}' must include a host",
            route.egress_rule_id, route.upstream.base_url
        ))
    })?;
    let grant = startup_input
        .egress_grant_by_rule_id
        .get(&route.egress_rule_id)
        .ok_or_else(|| {
            EgressProxyError::new(format!(
                "missing egress grant for route '{}'",
                route.egress_rule_id
            ))
        })?
        .clone();

    Ok(EgressProxyRoute {
        upstream_base_url: route.upstream.base_url.clone(),
        host: host.to_string(),
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
        grant,
    })
}

fn prepare_proxy_directory(path: &Path) -> Result<(), EgressProxyError> {
    DirBuilder::new()
        .recursive(true)
        .mode(0o700)
        .create(path)
        .map_err(|error| {
            EgressProxyError::new(format!(
                "failed to create local egress proxy directory '{}': {error}",
                path.display()
            ))
        })
}

fn build_managed_proxy_env(
    listener_address: SocketAddr,
    ca_certificate_path: &Path,
    tokenizer_proxy_egress_base_url: &str,
) -> Result<BTreeMap<String, String>, EgressProxyError> {
    let proxy_url = format!("http://{listener_address}");
    let certificate_path = ca_certificate_path.display().to_string();
    let no_proxy_value = build_no_proxy_value(tokenizer_proxy_egress_base_url)?;

    Ok(BTreeMap::from([
        ("HTTP_PROXY".to_string(), proxy_url.clone()),
        ("HTTPS_PROXY".to_string(), proxy_url.clone()),
        ("ALL_PROXY".to_string(), proxy_url.clone()),
        ("NO_PROXY".to_string(), no_proxy_value.clone()),
        ("http_proxy".to_string(), proxy_url.clone()),
        ("https_proxy".to_string(), proxy_url.clone()),
        ("all_proxy".to_string(), proxy_url),
        ("no_proxy".to_string(), no_proxy_value),
        ("SSL_CERT_FILE".to_string(), certificate_path.clone()),
        ("CURL_CA_BUNDLE".to_string(), certificate_path.clone()),
        ("GIT_SSL_CAINFO".to_string(), certificate_path.clone()),
        ("REQUESTS_CA_BUNDLE".to_string(), certificate_path.clone()),
        ("NODE_EXTRA_CA_CERTS".to_string(), certificate_path),
    ]))
}

fn build_no_proxy_value(tokenizer_proxy_egress_base_url: &str) -> Result<String, EgressProxyError> {
    let tokenizer_proxy_url =
        url::Url::parse(tokenizer_proxy_egress_base_url).map_err(|error| {
            EgressProxyError::new(format!(
                "sandbox tokenizer proxy egress base url '{tokenizer_proxy_egress_base_url}' is invalid: {error}"
            ))
        })?;
    let tokenizer_proxy_host = tokenizer_proxy_url.host_str().ok_or_else(|| {
        EgressProxyError::new(format!(
            "sandbox tokenizer proxy egress base url '{tokenizer_proxy_egress_base_url}' must include a host"
        ))
    })?;

    let mut no_proxy_hosts = RUNTIME_NO_PROXY_DEFAULTS
        .iter()
        .map(|value| (*value).to_string())
        .collect::<Vec<_>>();
    no_proxy_hosts.push(tokenizer_proxy_host.to_string());
    if let Some(port) = tokenizer_proxy_url.port() {
        no_proxy_hosts.push(format!("{tokenizer_proxy_host}:{port}"));
    }

    Ok(no_proxy_hosts.join(","))
}

fn run_proxy_server(
    std_listener: StdTcpListener,
    mut shutdown_rx: oneshot::Receiver<()>,
    state: EgressProxyState,
) -> Result<(), EgressProxyError> {
    let runtime = Builder::new_multi_thread()
        .enable_all()
        .build()
        .map_err(|error| {
            EgressProxyError::new(format!(
                "failed to start local egress proxy runtime: {error}"
            ))
        })?;

    runtime.block_on(async move {
        let listener = TcpListener::from_std(std_listener).map_err(|error| {
            EgressProxyError::new(format!("failed to create local egress proxy listener: {error}"))
        })?;

        loop {
            tokio::select! {
                _ = &mut shutdown_rx => return Ok(()),
                accept_result = listener.accept() => {
                    let (stream, _) = accept_result.map_err(|error| {
                        EgressProxyError::new(format!("local egress proxy accept failed: {error}"))
                    })?;
                    let state = state.clone();
                    tokio::spawn(async move {
                        let io = TokioIo::new(stream);
                        let service = service_fn(move |request| handle_proxy_request(request, state.clone(), None));
                        let connection = http1::Builder::new().serve_connection(io, service).with_upgrades();
                        let _ = connection.await;
                    });
                }
            }
        }
    })
}

async fn handle_proxy_request(
    request: Request<Incoming>,
    state: EgressProxyState,
    tunneled_authority: Option<String>,
) -> Result<Response<HyperBody>, Infallible> {
    if request.method() == Method::CONNECT {
        return Ok(handle_connect_request(request, state));
    }

    Ok(
        match forward_request(request, state, tunneled_authority).await {
            Ok(response) => response,
            Err(error) => text_response(StatusCode::BAD_GATEWAY, error.to_string()),
        },
    )
}

fn handle_connect_request(
    request: Request<Incoming>,
    state: EgressProxyState,
) -> Response<HyperBody> {
    let Some(authority) = request
        .uri()
        .authority()
        .map(|authority| authority.as_str().to_string())
    else {
        return text_response(
            StatusCode::BAD_REQUEST,
            "CONNECT requests must include a target authority",
        );
    };

    tokio::spawn(async move {
        let Ok(upgraded) = hyper::upgrade::on(request).await else {
            return;
        };
        let Ok(tls_acceptor) = build_tls_acceptor(
            &authority,
            state.proxy_ca_certificate_pem.as_str(),
            state.proxy_ca_private_key_pem.as_str(),
            state.clock.as_ref(),
        ) else {
            return;
        };
        let Ok(tls_stream) = tls_acceptor.accept(TokioIo::new(upgraded)).await else {
            return;
        };
        let service = service_fn(move |request| {
            handle_proxy_request(request, state.clone(), Some(authority.clone()))
        });
        let _ = http1::Builder::new()
            .serve_connection(TokioIo::new(tls_stream), service)
            .await;
    });

    Response::builder()
        .status(StatusCode::OK)
        .body(Full::new(Bytes::new()))
        .expect("CONNECT acknowledgement response should build")
}

async fn forward_request(
    request: Request<Incoming>,
    state: EgressProxyState,
    tunneled_authority: Option<String>,
) -> Result<Response<HyperBody>, EgressProxyError> {
    let (parts, body) = request.into_parts();
    let request_method = parts.method.clone();
    let request_target = resolve_request_target(&parts, tunneled_authority.as_deref())?;
    let request_path_and_query = request_target
        .uri
        .path_and_query()
        .map_or("/", |path_and_query| path_and_query.as_str());
    let route = match_route(
        &state.routes,
        &request_target.host,
        request_path_and_query,
        request_method.as_str(),
    )?;
    let request_body = body
        .collect()
        .await
        .map_err(|error| {
            EgressProxyError::new(format!("failed to read proxied request body: {error}"))
        })?
        .to_bytes();

    let mut outbound_request = Request::builder().method(request_method).uri(match route {
        Some(_) => build_tokenizer_proxy_forward_uri(
            &state.tokenizer_proxy_egress_base_url,
            request_path_and_query,
        )?,
        None => request_target.uri.clone(),
    });
    for (header_name, header_value) in filter_outbound_request_headers(&parts.headers) {
        outbound_request = outbound_request.header(header_name, header_value);
    }
    let outbound_request = match route {
        Some(route) => outbound_request
            .header(
                TOKENIZER_PROXY_EGRESS_GRANT_HEADER_NAME,
                route.grant.as_str(),
            )
            .body(Full::new(request_body))
            .map_err(|error| {
                EgressProxyError::new(format!("failed to build proxied request: {error}"))
            })?,
        None => outbound_request
            .body(Full::new(request_body))
            .map_err(|error| {
                EgressProxyError::new(format!("failed to build direct proxied request: {error}"))
            })?,
    };

    let upstream_response = state
        .client
        .request(outbound_request)
        .await
        .map_err(|error| match route {
            Some(route) => EgressProxyError::new(format!(
                "failed to forward request for '{}' through tokenizer-proxy route '{}': {error}",
                route.host, route.upstream_base_url
            )),
            None => EgressProxyError::new(format!(
                "failed to forward proxied request directly to '{}': {error}",
                request_target.authority
            )),
        })?;

    let (parts, body) = upstream_response.into_parts();
    let response_body = body
        .collect()
        .await
        .map_err(|error| {
            EgressProxyError::new(format!("failed to read proxied response body: {error}"))
        })?
        .to_bytes();
    let mut response_builder = Response::builder().status(parts.status);
    for (header_name, header_value) in filter_outbound_response_headers(&parts.headers) {
        response_builder = response_builder.header(header_name, header_value);
    }

    response_builder
        .body(Full::new(response_body))
        .map_err(|error| {
            EgressProxyError::new(format!("failed to build proxied response: {error}"))
        })
}

fn resolve_request_target(
    request: &hyper::http::request::Parts,
    tunneled_authority: Option<&str>,
) -> Result<RequestTarget, EgressProxyError> {
    let authority = match tunneled_authority {
        Some(tunneled_authority) => tunneled_authority.to_string(),
        None => {
            if let Some(authority) = request.uri.authority() {
                authority.as_str().to_string()
            } else if let Some(host) = request.headers.get(HOST) {
                host.to_str()
                    .map(|value| value.to_string())
                    .map_err(|error| {
                        EgressProxyError::new(format!(
                            "proxied request host header is invalid: {error}"
                        ))
                    })?
            } else {
                return Err(EgressProxyError::new("proxied request is missing a host"));
            }
        }
    };
    let scheme = if tunneled_authority.is_some() {
        "https"
    } else {
        request.uri.scheme_str().unwrap_or("http")
    };
    let uri = match (
        request.uri.scheme(),
        request.uri.authority(),
        tunneled_authority,
    ) {
        (Some(_), Some(_), None) => request.uri.clone(),
        _ => build_direct_forward_uri(scheme, &authority, request.uri.path_and_query())?,
    };

    Ok(RequestTarget {
        host: normalize_authority_host(&authority),
        authority,
        uri,
    })
}

fn build_direct_forward_uri(
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

fn normalize_authority_host(authority: &str) -> String {
    authority
        .trim()
        .strip_prefix('[')
        .and_then(|authority| authority.split_once(']'))
        .map_or_else(
            || {
                authority
                    .split_once(':')
                    .map_or_else(|| authority.to_string(), |(host, _)| host.to_string())
            },
            |(host, _)| host.to_string(),
        )
}

fn match_route<'a>(
    routes: &'a [EgressProxyRoute],
    host: &str,
    path: &str,
    method: &str,
) -> Result<Option<&'a EgressProxyRoute>, EgressProxyError> {
    let matching_routes = routes
        .iter()
        .filter(|route| {
            route.host == host
                && route
                    .path_prefixes
                    .iter()
                    .any(|path_prefix| path.starts_with(path_prefix))
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

fn build_tokenizer_proxy_forward_uri(
    tokenizer_proxy_egress_base_url: &str,
    path_and_query: &str,
) -> Result<Uri, EgressProxyError> {
    let mut tokenizer_proxy_url = url::Url::parse(tokenizer_proxy_egress_base_url).map_err(|error| {
        EgressProxyError::new(format!(
            "sandbox tokenizer proxy egress base url '{tokenizer_proxy_egress_base_url}' is invalid: {error}"
        ))
    })?;
    let path_and_query_url = url::Url::parse(&format!("http://proxy.internal{path_and_query}"))
        .map_err(|error| {
            EgressProxyError::new(format!(
                "proxied request target '{path_and_query}' is invalid: {error}"
            ))
        })?;
    tokenizer_proxy_url.set_path(&join_url_path(
        tokenizer_proxy_url.path(),
        path_and_query_url.path(),
    ));
    tokenizer_proxy_url.set_query(path_and_query_url.query());
    tokenizer_proxy_url.set_fragment(None);

    tokenizer_proxy_url.to_string().parse().map_err(|error| {
        EgressProxyError::new(format!(
            "failed to build tokenizer-proxy forward uri: {error}"
        ))
    })
}

fn join_url_path(base_path: &str, suffix_path: &str) -> String {
    let normalized_base_path = base_path.strip_suffix('/').unwrap_or(base_path);
    let normalized_suffix_path = suffix_path.strip_prefix('/').unwrap_or(suffix_path);

    if normalized_base_path.is_empty() || normalized_base_path == "/" {
        if normalized_suffix_path.is_empty() {
            return "/".to_string();
        }

        return format!("/{normalized_suffix_path}");
    }

    if normalized_suffix_path.is_empty() {
        return normalized_base_path.to_string();
    }

    format!("{normalized_base_path}/{normalized_suffix_path}")
}

fn filter_outbound_request_headers(
    headers: &hyper::HeaderMap<HeaderValue>,
) -> Vec<(HeaderName, HeaderValue)> {
    headers
        .iter()
        .filter_map(|(name, value)| {
            let blocked = matches!(
                name.as_str().to_ascii_lowercase().as_str(),
                "connection"
                    | "proxy-connection"
                    | "proxy-authenticate"
                    | "proxy-authorization"
                    | "keep-alive"
                    | "te"
                    | "trailer"
                    | "transfer-encoding"
                    | "upgrade"
                    | "host"
            );
            if blocked {
                return None;
            }
            Some((name.clone(), value.clone()))
        })
        .collect()
}

fn filter_outbound_response_headers(
    headers: &hyper::HeaderMap<HeaderValue>,
) -> Vec<(HeaderName, HeaderValue)> {
    headers
        .iter()
        .filter_map(|(name, value)| {
            let blocked = matches!(
                name.as_str().to_ascii_lowercase().as_str(),
                "connection"
                    | "proxy-connection"
                    | "proxy-authenticate"
                    | "proxy-authorization"
                    | "keep-alive"
                    | "te"
                    | "trailer"
                    | "transfer-encoding"
                    | "upgrade"
            );
            if blocked {
                return None;
            }
            Some((name.clone(), value.clone()))
        })
        .collect()
}

fn build_tls_acceptor(
    authority: &str,
    proxy_ca_certificate_pem: &str,
    proxy_ca_private_key_pem: &str,
    clock: &dyn Clock,
) -> Result<TlsAcceptor, EgressProxyError> {
    let issued_certificate = issue_proxy_leaf_certificate(
        proxy_ca_certificate_pem.to_string(),
        proxy_ca_private_key_pem.to_string(),
        authority.to_string(),
        clock,
    )
    .map_err(|error| EgressProxyError::new(error.to_string()))?;
    let certificate_chain = load_certificate_chain(&issued_certificate.certificate_chain_pem)?;
    let private_key = load_private_key(&issued_certificate.private_key_pem)?;
    let server_config = ServerConfig::builder()
        .with_no_client_auth()
        .with_single_cert(certificate_chain, private_key)
        .map_err(|error| {
            EgressProxyError::new(format!(
                "failed to build local egress proxy certificate chain: {error}"
            ))
        })?;

    Ok(TlsAcceptor::from(Arc::new(server_config)))
}

fn load_certificate_chain(
    certificate_chain_pem: &str,
) -> Result<Vec<CertificateDer<'static>>, EgressProxyError> {
    <(rustls_pki_types::pem::SectionKind, Vec<u8>)>::pem_slice_iter(
        certificate_chain_pem.as_bytes(),
    )
    .filter_map(|section| match section {
        Ok((rustls_pki_types::pem::SectionKind::Certificate, der)) => {
            Some(Ok(CertificateDer::from(der)))
        }
        Ok(_) => None,
        Err(error) => Some(Err(EgressProxyError::new(format!(
            "failed to parse local egress proxy certificate chain: {error}"
        )))),
    })
    .collect()
}

fn load_private_key(private_key_pem: &str) -> Result<PrivateKeyDer<'static>, EgressProxyError> {
    PrivateKeyDer::from_pem_slice(private_key_pem.as_bytes()).map_err(|error| {
        EgressProxyError::new(format!(
            "failed to parse local egress proxy private key: {error}"
        ))
    })
}

fn text_response(status: StatusCode, message: impl Into<String>) -> Response<HyperBody> {
    Response::builder()
        .status(status)
        .header("content-type", "text/plain; charset=utf-8")
        .body(Full::new(Bytes::from(message.into())))
        .expect("text response should build")
}

#[cfg(test)]
mod tests {
    use crate::egress_proxy::{
        EgressProxy, EgressProxyRoute, build_direct_forward_uri, build_managed_proxy_env,
        join_url_path, match_route,
    };

    #[test]
    fn joins_proxy_forward_paths_without_duplicate_slashes() {
        assert_eq!(
            join_url_path("/tokenizer-proxy/egress", "/graphql"),
            "/tokenizer-proxy/egress/graphql"
        );
        assert_eq!(
            join_url_path("/tokenizer-proxy/egress/", "/mistlehq/repo.git"),
            "/tokenizer-proxy/egress/mistlehq/repo.git"
        );
    }

    #[test]
    fn matches_route_by_host_path_and_method() {
        let routes = vec![
            EgressProxyRoute {
                upstream_base_url: "https://api.github.com".to_string(),
                host: "api.github.com".to_string(),
                path_prefixes: vec!["/graphql".to_string()],
                methods: Some(vec!["POST".to_string()]),
                grant: "grant-a".to_string(),
            },
            EgressProxyRoute {
                upstream_base_url: "https://github.com".to_string(),
                host: "github.com".to_string(),
                path_prefixes: vec!["/mistlehq/mistle.git".to_string()],
                methods: Some(vec!["GET".to_string()]),
                grant: "grant-b".to_string(),
            },
        ];

        let graphql_route = match_route(&routes, "api.github.com", "/graphql", "POST")
            .expect("graphql route should match");
        assert_eq!(
            graphql_route
                .expect("graphql route should resolve exactly one match")
                .grant,
            "grant-a"
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
                .grant,
            "grant-b"
        );
    }

    #[test]
    fn leaves_unmatched_requests_for_direct_passthrough() {
        let routes = vec![EgressProxyRoute {
            upstream_base_url: "https://api.openai.com".to_string(),
            host: "api.openai.com".to_string(),
            path_prefixes: vec!["/v1/responses".to_string()],
            methods: Some(vec!["POST".to_string()]),
            grant: "grant-a".to_string(),
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
            "tokenizer-proxy-dev_thomas.mistle.dev",
            Some(
                &"/tokenizer-proxy/egress/v1/responses?stream=true"
                    .parse()
                    .expect("path and query should parse"),
            ),
        )
        .expect("direct https forward uri should build");

        assert_eq!(
            direct_uri.to_string(),
            "https://tokenizer-proxy-dev_thomas.mistle.dev/tokenizer-proxy/egress/v1/responses?stream=true"
        );
    }

    #[test]
    fn managed_proxy_env_includes_proxy_and_ca_variables() {
        let env = build_managed_proxy_env(
            "127.0.0.1:4819"
                .parse()
                .expect("socket address should parse"),
            std::path::Path::new("/run/mistle/sandboxd/egress-proxy-ca.pem"),
            "http://tokenizer-proxy:5205/tokenizer-proxy/egress",
        )
        .expect("managed proxy environment should build");

        assert_eq!(
            env.get("HTTPS_PROXY"),
            Some(&"http://127.0.0.1:4819".to_string())
        );
        assert_eq!(
            env.get("NO_PROXY"),
            Some(&"127.0.0.1,localhost,tokenizer-proxy,tokenizer-proxy:5205".to_string())
        );
        assert_eq!(
            env.get("SSL_CERT_FILE"),
            Some(&"/run/mistle/sandboxd/egress-proxy-ca.pem".to_string())
        );
        assert!(EgressProxy::managed_env_keys().contains(&"HTTPS_PROXY"));
        assert!(EgressProxy::managed_env_keys().contains(&"NODE_EXTRA_CA_CERTS"));
    }
}
