use std::fmt::{Display, Formatter};
use std::net::IpAddr;
use std::str::FromStr;
use std::time::{Duration, SystemTime};

use rcgen::{
    BasicConstraints, CertificateParams, DistinguishedName, DnType, IsCa, KeyPair,
    KeyUsagePurpose, SanType,
};

const PROXY_CA_COMMON_NAME: &str = "Mistle Sandbox Proxy CA";
const PROXY_CA_VALIDITY: Duration = Duration::from_secs(24 * 60 * 60);
const PROXY_LEAF_VALIDITY: Duration = Duration::from_secs(12 * 60 * 60);

pub struct GeneratedProxyCa {
    pub certificate_pem: String,
    pub private_key_pem: String,
}

pub struct IssuedProxyLeafCertificate {
    pub certificate_chain_pem: String,
    pub private_key_pem: String,
}

#[derive(Debug)]
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
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for ProxyCaError {}

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

fn base_proxy_ca_params() -> CertificateParams {
    let now = SystemTime::now();
    let mut distinguished_name = DistinguishedName::new();
    distinguished_name.push(DnType::CommonName, PROXY_CA_COMMON_NAME);

    let mut params = CertificateParams::default();
    params.distinguished_name = distinguished_name;
    params.is_ca = IsCa::Ca(BasicConstraints::Unconstrained);
    params.not_before = now.checked_sub(Duration::from_secs(60)).unwrap_or(now).into();
    params.not_after = now
        .checked_add(PROXY_CA_VALIDITY)
        .unwrap_or(now + PROXY_CA_VALIDITY)
        .into();
    params.key_usages = vec![
        KeyUsagePurpose::KeyCertSign,
        KeyUsagePurpose::CrlSign,
        KeyUsagePurpose::DigitalSignature,
    ];
    params
}

pub fn generate_proxy_ca_impl() -> Result<GeneratedProxyCa, ProxyCaError> {
    let key_pair = KeyPair::generate()
        .map_err(|error| ProxyCaError::new(format!("failed to generate proxy ca private key: {error}")))?;
    let params = base_proxy_ca_params();
    let certificate = params
        .self_signed(&key_pair)
        .map_err(|error| ProxyCaError::new(format!("failed to generate proxy ca certificate: {error}")))?;

    Ok(GeneratedProxyCa {
        certificate_pem: certificate.pem(),
        private_key_pem: key_pair.serialize_pem(),
    })
}

pub fn issue_proxy_leaf_certificate_impl(
    ca_certificate_pem: String,
    ca_private_key_pem: String,
    server_name: String,
) -> Result<IssuedProxyLeafCertificate, ProxyCaError> {
    let normalized_server_name = normalize_certificate_host(&server_name);
    if normalized_server_name.is_empty() {
        return Err(ProxyCaError::new("server name is required"));
    }

    let ca_key_pair = KeyPair::from_pem(&ca_private_key_pem)
        .map_err(|error| ProxyCaError::new(format!("failed to parse proxy ca private key: {error}")))?;
    if ca_certificate_pem.trim().is_empty() {
        return Err(ProxyCaError::new("proxy ca certificate pem is invalid"));
    }

    let issuer_certificate = base_proxy_ca_params()
        .self_signed(&ca_key_pair)
        .map_err(|error| ProxyCaError::new(format!("failed to reconstruct proxy ca certificate: {error}")))?;

    let leaf_key_pair = KeyPair::generate().map_err(|error| {
        ProxyCaError::new(format!("failed to generate leaf private key for \"{normalized_server_name}\": {error}"))
    })?;

    let now = SystemTime::now();
    let mut distinguished_name = DistinguishedName::new();
    distinguished_name.push(DnType::CommonName, normalized_server_name.clone());

    let mut params = CertificateParams::new(Vec::new())
        .map_err(|error| ProxyCaError::new(format!("failed to create leaf certificate params: {error}")))?;
    params.distinguished_name = distinguished_name;
    params.not_before = now.checked_sub(Duration::from_secs(60)).unwrap_or(now).into();
    params.not_after = now
        .checked_add(PROXY_LEAF_VALIDITY)
        .unwrap_or(now + PROXY_LEAF_VALIDITY)
        .into();
    params.key_usages = vec![
        KeyUsagePurpose::DigitalSignature,
        KeyUsagePurpose::KeyEncipherment,
    ];
    params.extended_key_usages = vec![rcgen::ExtendedKeyUsagePurpose::ServerAuth];

    if let Ok(ip_address) = IpAddr::from_str(&normalized_server_name) {
        params.subject_alt_names.push(SanType::IpAddress(ip_address));
    } else {
        params
            .subject_alt_names
            .push(SanType::DnsName(normalized_server_name.clone().try_into().map_err(
                |error| ProxyCaError::new(format!("failed to encode leaf dns name \"{normalized_server_name}\": {error}")),
            )?));
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

#[cfg(test)]
mod tests {
    use super::{generate_proxy_ca_impl, issue_proxy_leaf_certificate_impl};

    #[test]
    fn generates_a_ca_and_issues_leaf_certificates() {
        let generated_proxy_ca =
            generate_proxy_ca_impl().expect("expected proxy ca generation to succeed");

        assert!(generated_proxy_ca.certificate_pem.contains("BEGIN CERTIFICATE"));
        assert!(generated_proxy_ca.private_key_pem.contains("BEGIN PRIVATE KEY"));

        let leaf_certificate = issue_proxy_leaf_certificate_impl(
            generated_proxy_ca.certificate_pem.clone(),
            generated_proxy_ca.private_key_pem.clone(),
            "api.openai.com:443".to_string(),
        )
        .expect("expected leaf certificate issuance to succeed");

        assert!(
            leaf_certificate
                .certificate_chain_pem
                .contains("BEGIN CERTIFICATE")
        );
        assert!(leaf_certificate.private_key_pem.contains("BEGIN PRIVATE KEY"));
        assert_eq!(
            leaf_certificate
                .certificate_chain_pem
                .matches("BEGIN CERTIFICATE")
                .count(),
            2
        );
    }

    #[test]
    fn rejects_empty_server_names() {
        let generated_proxy_ca =
            generate_proxy_ca_impl().expect("expected proxy ca generation to succeed");

        let error = match issue_proxy_leaf_certificate_impl(
            generated_proxy_ca.certificate_pem,
            generated_proxy_ca.private_key_pem,
            "   ".to_string(),
        ) {
            Ok(_) => panic!("expected empty server name to fail"),
            Err(error) => error,
        };

        assert_eq!(error.to_string(), "server name is required");
    }
}
