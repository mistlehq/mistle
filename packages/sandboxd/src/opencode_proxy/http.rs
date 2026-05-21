use bytes::Bytes;
use http_body_util::{BodyExt, Full};
use hyper::{Method, Request, Uri};
use hyper_rustls::{HttpsConnector, HttpsConnectorBuilder};
use hyper_util::client::legacy::Client;
use hyper_util::client::legacy::connect::HttpConnector;
use hyper_util::rt::TokioExecutor;
use url::Url;

use crate::opencode_proxy::OpenCodeProxyError;

pub(super) type OpenCodeHttpClient = Client<HttpsConnector<HttpConnector>, Full<Bytes>>;

pub(super) async fn issue_opencode_get_request(
    raw_server_url: &str,
    client: OpenCodeHttpClient,
    path: &str,
) -> Result<hyper::Response<hyper::body::Incoming>, OpenCodeProxyError> {
    let target_uri = build_opencode_target_uri(raw_server_url, path)?;
    let request = Request::builder()
        .method(Method::GET)
        .uri(target_uri)
        .body(Full::new(Bytes::new()))
        .map_err(|error| OpenCodeProxyError::ConfigureRuntime(error.to_string()))?;

    client
        .request(request)
        .await
        .map_err(|error| OpenCodeProxyError::HttpRequest(error.to_string()))
}

pub(super) async fn read_response_body(
    mut body: hyper::body::Incoming,
) -> Result<String, OpenCodeProxyError> {
    let mut bytes = Vec::new();
    while let Some(frame) = body.frame().await {
        let frame = frame.map_err(|error| OpenCodeProxyError::HttpRequest(error.to_string()))?;
        if let Ok(chunk) = frame.into_data() {
            bytes.extend_from_slice(chunk.as_ref());
        }
    }

    String::from_utf8(bytes).map_err(|error| OpenCodeProxyError::HttpRequest(error.to_string()))
}

pub(super) fn build_opencode_target_uri(
    raw_server_url: &str,
    path: &str,
) -> Result<Uri, OpenCodeProxyError> {
    if !path.starts_with('/') {
        return Err(OpenCodeProxyError::InvalidHttpTarget(path.to_string()));
    }
    let base = Url::parse(raw_server_url)
        .map_err(|error| OpenCodeProxyError::ParseRawUrl(error.to_string()))?;
    let target = base
        .join(path)
        .map_err(|error| OpenCodeProxyError::InvalidHttpTarget(error.to_string()))?;
    target
        .to_string()
        .parse::<Uri>()
        .map_err(|error| OpenCodeProxyError::InvalidHttpTarget(error.to_string()))
}

pub(super) fn build_opencode_http_client() -> Result<OpenCodeHttpClient, OpenCodeProxyError> {
    let mut http_connector = HttpConnector::new();
    http_connector.enforce_http(false);
    let https_connector = HttpsConnectorBuilder::new()
        .with_native_roots()
        .map_err(|error| OpenCodeProxyError::ConfigureRuntime(error.to_string()))?
        .https_or_http()
        .enable_http1()
        .wrap_connector(http_connector);
    Ok(Client::builder(TokioExecutor::new()).build(https_connector))
}

pub(super) fn derive_opencode_raw_server_url_from_readiness_url(
    readiness_url: &str,
) -> Result<String, OpenCodeProxyError> {
    let mut parsed_url = Url::parse(readiness_url)
        .map_err(|error| OpenCodeProxyError::ParseRawUrl(error.to_string()))?;
    if parsed_url.scheme() != "http" && parsed_url.scheme() != "https" {
        return Err(OpenCodeProxyError::RawUrlMustUseHttp {
            url: readiness_url.to_string(),
        });
    }
    if parsed_url.path() != "/global/health" {
        return Err(OpenCodeProxyError::ConfigureRuntime(format!(
            "OpenCode process readiness URL must target /global/health: {readiness_url}"
        )));
    }
    parsed_url.set_path("");
    parsed_url.set_query(None);
    parsed_url.set_fragment(None);
    Ok(parsed_url.to_string().trim_end_matches('/').to_string())
}
