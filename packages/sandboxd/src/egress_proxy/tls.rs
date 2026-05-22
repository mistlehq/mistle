//! TLS helpers for intercepted and direct egress proxy connections.
//!
//! The server delegates certificate generation, TLS accept/connect setup, and
//! websocket target URL construction here so forwarding logic can stay focused
//! on protocol flow.

use std::sync::Arc;

use hyper::Uri;
use hyper_rustls::ConfigBuilderExt;
use rustls_pki_types::pem::PemObject;
use rustls_pki_types::{CertificateDer, PrivateKeyDer};
use tokio_rustls::TlsConnector;
use tokio_rustls::rustls::ClientConfig;
use tokio_rustls::rustls::pki_types::ServerName;
use tokio_rustls::rustls::{ServerConfig, server::Acceptor as RustlsServerAcceptor};
use tokio_rustls::{LazyConfigAcceptor, TlsAcceptor};
use url::Url;

use crate::egress_proxy::{EgressProxyError, EgressProxyState};
use crate::proxy_ca::issue_proxy_leaf_certificate;
use crate::time::Clock;

pub(super) async fn accept_transparent_tls_stream(
    stream: tokio::net::TcpStream,
    fallback_authority: &str,
    state: EgressProxyState,
) -> Result<tokio_rustls::server::TlsStream<tokio::net::TcpStream>, EgressProxyError> {
    let lazy_acceptor = LazyConfigAcceptor::new(RustlsServerAcceptor::default(), stream);
    let start_handshake = lazy_acceptor.await.map_err(|error| {
        EgressProxyError::new(format!(
            "failed to read transparent TLS client hello: {error}"
        ))
    })?;
    let certificate_name = start_handshake
        .client_hello()
        .server_name()
        .map_or_else(|| fallback_authority.to_string(), ToString::to_string);
    let server_config = build_tls_server_config(
        &certificate_name,
        state.proxy_ca_certificate_pem.as_str(),
        state.proxy_ca_private_key_pem.as_str(),
        state.clock.as_ref(),
    )?;
    start_handshake
        .into_stream(Arc::new(server_config))
        .await
        .map_err(|error| EgressProxyError::new(format!("transparent TLS MITM failed: {error}")))
}

pub(super) fn build_tls_acceptor(
    authority: &str,
    proxy_ca_certificate_pem: &str,
    proxy_ca_private_key_pem: &str,
    clock: &dyn Clock,
) -> Result<TlsAcceptor, EgressProxyError> {
    Ok(TlsAcceptor::from(Arc::new(build_tls_server_config(
        authority,
        proxy_ca_certificate_pem,
        proxy_ca_private_key_pem,
        clock,
    )?)))
}

fn build_tls_server_config(
    authority: &str,
    proxy_ca_certificate_pem: &str,
    proxy_ca_private_key_pem: &str,
    clock: &dyn Clock,
) -> Result<ServerConfig, EgressProxyError> {
    let issued_certificate = issue_proxy_leaf_certificate(
        proxy_ca_certificate_pem.to_string(),
        proxy_ca_private_key_pem.to_string(),
        authority.to_string(),
        clock,
    )
    .map_err(|error| EgressProxyError::new(error.to_string()))?;
    let certificate_chain = load_certificate_chain(&issued_certificate.certificate_chain_pem)?;
    let private_key = load_private_key(&issued_certificate.private_key_pem)?;
    ServerConfig::builder()
        .with_no_client_auth()
        .with_single_cert(certificate_chain, private_key)
        .map_err(|error| {
            EgressProxyError::new(format!(
                "failed to build local egress proxy certificate chain: {error}"
            ))
        })
}

pub(super) fn build_direct_tls_connector() -> Result<TlsConnector, EgressProxyError> {
    let config = ClientConfig::builder()
        .with_native_roots()
        .map_err(|error| {
            EgressProxyError::new(format!(
                "failed to load native roots for direct upstream TLS: {error}"
            ))
        })?
        .with_no_client_auth();
    Ok(TlsConnector::from(Arc::new(config)))
}

pub(super) fn tls_server_name(
    host: &str,
    context: &str,
) -> Result<ServerName<'static>, EgressProxyError> {
    ServerName::try_from(host.to_string()).map_err(|error| {
        EgressProxyError::new(format!(
            "{context} host '{host}' is not a valid TLS server name: {error}"
        ))
    })
}

pub(super) fn websocket_target_url(target_url: &Uri) -> Result<String, EgressProxyError> {
    let mut parsed_target = Url::parse(&target_url.to_string()).map_err(|error| {
        EgressProxyError::new(format!(
            "failed to parse websocket egress target '{target_url}': {error}"
        ))
    })?;
    match parsed_target.scheme() {
        "http" => parsed_target.set_scheme("ws").map_err(|_| {
            EgressProxyError::new("failed to set websocket egress target scheme to ws")
        })?,
        "https" => parsed_target.set_scheme("wss").map_err(|_| {
            EgressProxyError::new("failed to set websocket egress target scheme to wss")
        })?,
        "ws" | "wss" => {}
        scheme => {
            return Err(EgressProxyError::new(format!(
                "websocket egress target must use http, https, ws, or wss scheme, got '{scheme}'"
            )));
        }
    }
    Ok(parsed_target.to_string())
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
