//! Ephemeral certificate-authority helpers for the runtime-side local proxy.
//!
//! This module generates a short-lived in-memory CA, issues per-runtime leaf
//! certificates, and prepares inherited file descriptors so the future runtime
//! exec handoff can consume the CA material without persisting it to disk.

use std::collections::BTreeMap;
use std::fmt::{self, Display};
use std::net::IpAddr;
use std::os::fd::{AsRawFd, OwnedFd};
use std::str::FromStr;

use nix::fcntl::{FcntlArg, FdFlag, fcntl};
use nix::unistd::{pipe, write};
use rcgen::{
    BasicConstraints, CertificateParams, DistinguishedName, DnType, IsCa, KeyPair, KeyUsagePurpose,
    SanType,
};

use crate::time::{Clock, add_millis, subtract_millis};

const PROXY_CA_COMMON_NAME: &str = "Mistle Sandbox Proxy CA";
const PROXY_CA_VALIDITY_MS: u64 = 24 * 60 * 60 * 1000;
const PROXY_LEAF_VALIDITY_MS: u64 = 12 * 60 * 60 * 1000;
const CERTIFICATE_CLOCK_SKEW_MS: u64 = 60 * 1000;

/// Environment variable pointing at the inherited proxy CA certificate fd.
pub const PROXY_CA_CERT_FD_ENV: &str = "SANDBOX_RUNTIME_PROXY_CA_CERT_FD";
/// Environment variable pointing at the inherited proxy CA private-key fd.
pub const PROXY_CA_KEY_FD_ENV: &str = "SANDBOX_RUNTIME_PROXY_CA_KEY_FD";

/// Carries one freshly generated proxy CA as PEM strings.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GeneratedProxyCa {
    pub certificate_pem: String,
    pub private_key_pem: String,
}

/// Carries one issued proxy leaf certificate chain and private key as PEM strings.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IssuedProxyLeafCertificate {
    pub certificate_chain_pem: String,
    pub private_key_pem: String,
}

/// Owns the inherited file descriptors that carry proxy CA material into a child runtime.
#[derive(Debug)]
pub struct PreparedProxyCaRuntime {
    certificate_fd: Option<OwnedFd>,
    private_key_fd: Option<OwnedFd>,
}

/// Describes why proxy CA generation, issuance, or fd preparation failed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProxyCaError {
    message: String,
}

impl ProxyCaError {
    fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }
}

impl Display for ProxyCaError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for ProxyCaError {}

impl PreparedProxyCaRuntime {
    /// Returns the inherited fd carrying the proxy CA certificate payload.
    pub fn certificate_fd(&self) -> Result<i32, ProxyCaError> {
        let fd = self.certificate_fd.as_ref().ok_or_else(|| {
            ProxyCaError::new("proxy ca certificate fd has already been cleaned up")
        })?;
        Ok(fd.as_raw_fd())
    }

    /// Returns the inherited fd carrying the proxy CA private-key payload.
    pub fn private_key_fd(&self) -> Result<i32, ProxyCaError> {
        let fd = self.private_key_fd.as_ref().ok_or_else(|| {
            ProxyCaError::new("proxy ca private key fd has already been cleaned up")
        })?;
        Ok(fd.as_raw_fd())
    }

    /// Returns the environment variables that point the child runtime at both inherited fds.
    pub fn env(&self) -> Result<BTreeMap<String, String>, ProxyCaError> {
        let mut env = BTreeMap::new();
        env.insert(
            PROXY_CA_CERT_FD_ENV.to_string(),
            self.certificate_fd()?.to_string(),
        );
        env.insert(
            PROXY_CA_KEY_FD_ENV.to_string(),
            self.private_key_fd()?.to_string(),
        );
        Ok(env)
    }

    /// Closes any owned proxy CA descriptors early.
    pub fn cleanup(&mut self) {
        let _ = self.certificate_fd.take();
        let _ = self.private_key_fd.take();
    }
}

/// Normalizes the runtime server name before it becomes a certificate subject or SAN.
fn normalize_certificate_host(server_name: &str) -> String {
    let trimmed_server_name = server_name.trim().to_lowercase();
    if trimmed_server_name.is_empty() {
        return trimmed_server_name;
    }

    if trimmed_server_name.starts_with('[')
        && let Some(end_bracket_index) = trimmed_server_name.find(']')
    {
        return trimmed_server_name[1..end_bracket_index].to_string();
    }

    if trimmed_server_name.matches(':').count() == 1
        && let Some((host, port)) = trimmed_server_name.rsplit_once(':')
        && !host.is_empty()
        && !port.is_empty()
        && port.parse::<u16>().is_ok()
    {
        return host.to_string();
    }

    trimmed_server_name
}

/// Builds the CA certificate parameters using the injected wall clock.
fn base_proxy_ca_params(clock: &dyn Clock) -> CertificateParams {
    let now = clock.now_system_time();
    let mut distinguished_name = DistinguishedName::new();
    distinguished_name.push(DnType::CommonName, PROXY_CA_COMMON_NAME);

    let mut params = CertificateParams::default();
    params.distinguished_name = distinguished_name;
    params.is_ca = IsCa::Ca(BasicConstraints::Unconstrained);
    params.not_before = subtract_millis(now, CERTIFICATE_CLOCK_SKEW_MS).into();
    params.not_after = add_millis(now, PROXY_CA_VALIDITY_MS).into();
    params.key_usages = vec![
        KeyUsagePurpose::KeyCertSign,
        KeyUsagePurpose::CrlSign,
        KeyUsagePurpose::DigitalSignature,
    ];
    params
}

/// Generates a short-lived proxy CA for one runtime supervisor instance.
pub fn generate_proxy_ca(clock: &dyn Clock) -> Result<GeneratedProxyCa, ProxyCaError> {
    let key_pair = KeyPair::generate().map_err(|error| {
        ProxyCaError::new(format!("failed to generate proxy ca private key: {error}"))
    })?;
    let params = base_proxy_ca_params(clock);
    let certificate = params.self_signed(&key_pair).map_err(|error| {
        ProxyCaError::new(format!("failed to generate proxy ca certificate: {error}"))
    })?;

    Ok(GeneratedProxyCa {
        certificate_pem: certificate.pem(),
        private_key_pem: key_pair.serialize_pem(),
    })
}

/// Issues one proxy leaf certificate signed by the provided CA material.
pub fn issue_proxy_leaf_certificate(
    ca_certificate_pem: String,
    ca_private_key_pem: String,
    server_name: String,
    clock: &dyn Clock,
) -> Result<IssuedProxyLeafCertificate, ProxyCaError> {
    let normalized_server_name = normalize_certificate_host(&server_name);
    if normalized_server_name.is_empty() {
        return Err(ProxyCaError::new("server name is required"));
    }

    let ca_key_pair = KeyPair::from_pem(&ca_private_key_pem).map_err(|error| {
        ProxyCaError::new(format!("failed to parse proxy ca private key: {error}"))
    })?;
    if ca_certificate_pem.trim().is_empty() {
        return Err(ProxyCaError::new("proxy ca certificate pem is invalid"));
    }

    let issuer_certificate = base_proxy_ca_params(clock)
        .self_signed(&ca_key_pair)
        .map_err(|error| {
            ProxyCaError::new(format!(
                "failed to reconstruct proxy ca certificate: {error}"
            ))
        })?;

    let leaf_key_pair = KeyPair::generate().map_err(|error| {
        ProxyCaError::new(format!(
            "failed to generate leaf private key for \"{normalized_server_name}\": {error}"
        ))
    })?;

    let now = clock.now_system_time();
    let mut distinguished_name = DistinguishedName::new();
    distinguished_name.push(DnType::CommonName, normalized_server_name.clone());

    let mut params = CertificateParams::new(Vec::new()).map_err(|error| {
        ProxyCaError::new(format!("failed to create leaf certificate params: {error}"))
    })?;
    params.distinguished_name = distinguished_name;
    params.not_before = subtract_millis(now, CERTIFICATE_CLOCK_SKEW_MS).into();
    params.not_after = add_millis(now, PROXY_LEAF_VALIDITY_MS).into();
    params.key_usages = vec![
        KeyUsagePurpose::DigitalSignature,
        KeyUsagePurpose::KeyEncipherment,
    ];
    params.extended_key_usages = vec![rcgen::ExtendedKeyUsagePurpose::ServerAuth];

    if let Ok(ip_address) = IpAddr::from_str(&normalized_server_name) {
        params
            .subject_alt_names
            .push(SanType::IpAddress(ip_address));
    } else {
        params.subject_alt_names.push(SanType::DnsName(
            normalized_server_name.clone().try_into().map_err(|error| {
                ProxyCaError::new(format!(
                    "failed to encode leaf dns name \"{normalized_server_name}\": {error}"
                ))
            })?,
        ));
    }

    let leaf_certificate = params
        .signed_by(&leaf_key_pair, &issuer_certificate, &ca_key_pair)
        .map_err(|error| {
            ProxyCaError::new(format!(
                "failed to issue leaf certificate for \"{normalized_server_name}\": {error}"
            ))
        })?;

    Ok(IssuedProxyLeafCertificate {
        certificate_chain_pem: format!("{}{}", leaf_certificate.pem(), ca_certificate_pem),
        private_key_pem: leaf_key_pair.serialize_pem(),
    })
}

/// Materializes one PEM payload onto an inherited read fd.
fn prepare_proxy_ca_fd_payload(name: &str, payload: &str) -> Result<OwnedFd, ProxyCaError> {
    if payload.trim().is_empty() {
        return Err(ProxyCaError::new(format!("{name} must not be empty")));
    }

    let (read_fd, write_fd) = pipe()
        .map_err(|error| ProxyCaError::new(format!("failed to create {name} pipe: {error}")))?;

    // Keep the proxy CA material on inherited descriptors so the future runtime
    // handoff can pass it across exec without persisting secrets to disk.
    let mut remaining_payload = payload.as_bytes();
    while !remaining_payload.is_empty() {
        match write(&write_fd, remaining_payload) {
            Ok(0) => {
                return Err(ProxyCaError::new(format!(
                    "failed to write complete {name} payload"
                )));
            }
            Ok(bytes_written) => {
                remaining_payload = &remaining_payload[bytes_written..];
            }
            Err(error) => {
                return Err(ProxyCaError::new(format!(
                    "failed to write {name} payload: {error}"
                )));
            }
        }
    }

    drop(write_fd);

    let flags_bits = fcntl(&read_fd, FcntlArg::F_GETFD)
        .map_err(|error| ProxyCaError::new(format!("failed to read {name} fd flags: {error}")))?;
    let flags = FdFlag::from_bits_truncate(flags_bits);
    let updated_flags = flags & !FdFlag::FD_CLOEXEC;
    fcntl(&read_fd, FcntlArg::F_SETFD(updated_flags)).map_err(|error| {
        ProxyCaError::new(format!(
            "failed to clear close-on-exec for {name} fd: {error}"
        ))
    })?;

    Ok(read_fd)
}

/// Prepares the generated CA material for runtime exec handoff via inherited fds.
pub fn prepare_proxy_ca_runtime(
    generated_proxy_ca: &GeneratedProxyCa,
) -> Result<PreparedProxyCaRuntime, ProxyCaError> {
    let certificate_fd =
        prepare_proxy_ca_fd_payload("proxy ca certificate", &generated_proxy_ca.certificate_pem)?;
    let private_key_fd =
        prepare_proxy_ca_fd_payload("proxy ca private key", &generated_proxy_ca.private_key_pem)?;

    Ok(PreparedProxyCaRuntime {
        certificate_fd: Some(certificate_fd),
        private_key_fd: Some(private_key_fd),
    })
}
