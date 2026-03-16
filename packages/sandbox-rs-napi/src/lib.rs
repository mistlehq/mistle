mod proxy_ca;

use napi_derive::napi;
use proxy_ca::{
    generate_proxy_ca_impl, issue_proxy_leaf_certificate_impl, GeneratedProxyCa,
    IssuedProxyLeafCertificate,
};

#[napi]
pub fn scaffold_marker() -> &'static str {
    "sandbox-rs-napi"
}

#[napi(object)]
pub struct GeneratedProxyCaResult {
    pub certificate_pem: String,
    pub private_key_pem: String,
}

#[napi(object)]
pub struct IssueProxyLeafCertificateInput {
    pub ca_certificate_pem: String,
    pub ca_private_key_pem: String,
    pub server_name: String,
}

#[napi(object)]
pub struct IssuedProxyLeafCertificateResult {
    pub certificate_chain_pem: String,
    pub private_key_pem: String,
}

#[napi]
pub fn generate_proxy_ca() -> napi::Result<GeneratedProxyCaResult> {
    let GeneratedProxyCa {
        certificate_pem,
        private_key_pem,
    } = generate_proxy_ca_impl().map_err(|error| napi::Error::from_reason(error.to_string()))?;

    Ok(GeneratedProxyCaResult {
        certificate_pem,
        private_key_pem,
    })
}

#[napi]
pub fn issue_proxy_leaf_certificate(
    input: IssueProxyLeafCertificateInput,
) -> napi::Result<IssuedProxyLeafCertificateResult> {
    let IssuedProxyLeafCertificate {
        certificate_chain_pem,
        private_key_pem,
    } = issue_proxy_leaf_certificate_impl(
        input.ca_certificate_pem,
        input.ca_private_key_pem,
        input.server_name,
    )
    .map_err(|error| napi::Error::from_reason(error.to_string()))?;

    Ok(IssuedProxyLeafCertificateResult {
        certificate_chain_pem,
        private_key_pem,
    })
}
