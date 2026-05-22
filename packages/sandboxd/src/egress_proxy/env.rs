//! Environment variable wiring for managed proxy processes.
//!
//! Runtime clients inherit these values so common tools use the sandbox-local
//! proxy and trust its CA without each process module knowing proxy internals.

use std::collections::BTreeMap;
use std::path::Path;

use crate::egress_proxy::EgressProxyError;

pub(super) const MANAGED_PROXY_ENV_KEYS: [&str; 8] = [
    "SSL_CERT_FILE",
    "CURL_CA_BUNDLE",
    "GIT_SSL_CAINFO",
    "REQUESTS_CA_BUNDLE",
    "NODE_EXTRA_CA_CERTS",
    "NIX_SSL_CERT_FILE",
    "SSL_CERT_DIR",
    "GIT_SSL_CAPATH",
];

pub(super) fn build_managed_proxy_env(
    ca_certificate_path: &Path,
) -> Result<BTreeMap<String, String>, EgressProxyError> {
    let certificate_path = ca_certificate_path.display().to_string();

    Ok(BTreeMap::from([
        ("SSL_CERT_FILE".to_string(), certificate_path.clone()),
        ("CURL_CA_BUNDLE".to_string(), certificate_path.clone()),
        ("GIT_SSL_CAINFO".to_string(), certificate_path.clone()),
        ("REQUESTS_CA_BUNDLE".to_string(), certificate_path.clone()),
        ("NODE_EXTRA_CA_CERTS".to_string(), certificate_path.clone()),
        ("NIX_SSL_CERT_FILE".to_string(), certificate_path),
    ]))
}
