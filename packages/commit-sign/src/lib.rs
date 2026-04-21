use base64::Engine;
use base64::engine::general_purpose::STANDARD as Base64Standard;
use serde::{Deserialize, Serialize};
use ssh_key::{HashAlg, LineEnding, PrivateKey};
use std::fmt::{self, Display};

pub const COMMIT_SIGNING_NAMESPACE: &str = "git";
pub const SSH_SIGNING_FORMAT: &str = "ssh";
pub const PEM_SIGNATURE_ENCODING: &str = "pem";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CommitSignRequest {
    pub format: String,
    pub private_key: String,
    pub payload_base64: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CommitSignResponse {
    pub format: String,
    pub signature: String,
    pub signature_encoding: String,
}

#[derive(Debug)]
pub enum CommitSignError {
    InvalidRequestJson(String),
    InvalidResponseJson(String),
    UnsupportedFormat(String),
    InvalidPayloadBase64(String),
    InvalidPrivateKey(String),
    EncryptedPrivateKey,
    SignatureCreationFailed(String),
    SignatureSerializationFailed(String),
    Io(std::io::Error),
}

impl Display for CommitSignError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidRequestJson(error) => {
                write!(f, "invalid commit-sign request json: {error}")
            }
            Self::InvalidResponseJson(error) => {
                write!(f, "invalid commit-sign response json: {error}")
            }
            Self::UnsupportedFormat(format) => {
                write!(f, "unsupported commit signing format: {format}")
            }
            Self::InvalidPayloadBase64(error) => {
                write!(f, "invalid commit payload base64: {error}")
            }
            Self::InvalidPrivateKey(error) => {
                write!(f, "invalid SSH private key: {error}")
            }
            Self::EncryptedPrivateKey => {
                f.write_str("encrypted SSH private keys are not supported")
            }
            Self::SignatureCreationFailed(error) => {
                write!(f, "failed to sign commit payload: {error}")
            }
            Self::SignatureSerializationFailed(error) => {
                write!(f, "failed to serialize commit signature: {error}")
            }
            Self::Io(error) => write!(f, "commit-sign I/O error: {error}"),
        }
    }
}

impl std::error::Error for CommitSignError {}

impl From<std::io::Error> for CommitSignError {
    fn from(error: std::io::Error) -> Self {
        Self::Io(error)
    }
}

pub fn sign_commit_payload(
    request: &CommitSignRequest,
) -> Result<CommitSignResponse, CommitSignError> {
    if request.format != SSH_SIGNING_FORMAT {
        return Err(CommitSignError::UnsupportedFormat(request.format.clone()));
    }

    let payload = Base64Standard
        .decode(&request.payload_base64)
        .map_err(|error| CommitSignError::InvalidPayloadBase64(error.to_string()))?;

    let private_key = PrivateKey::from_openssh(&request.private_key)
        .map_err(|error| CommitSignError::InvalidPrivateKey(error.to_string()))?;
    if private_key.is_encrypted() {
        return Err(CommitSignError::EncryptedPrivateKey);
    }

    let signature = private_key
        .sign(COMMIT_SIGNING_NAMESPACE, HashAlg::Sha512, &payload)
        .map_err(|error| CommitSignError::SignatureCreationFailed(error.to_string()))?;
    let signature_pem = signature
        .to_pem(LineEnding::LF)
        .map_err(|error| CommitSignError::SignatureSerializationFailed(error.to_string()))?;

    Ok(CommitSignResponse {
        format: request.format.clone(),
        signature: signature_pem,
        signature_encoding: PEM_SIGNATURE_ENCODING.to_string(),
    })
}

pub fn parse_request(input: &str) -> Result<CommitSignRequest, CommitSignError> {
    serde_json::from_str(input)
        .map_err(|error| CommitSignError::InvalidRequestJson(error.to_string()))
}

pub fn serialize_response(response: &CommitSignResponse) -> Result<String, CommitSignError> {
    serde_json::to_string(response)
        .map_err(|error| CommitSignError::InvalidResponseJson(error.to_string()))
}

#[cfg(test)]
mod tests {
    use super::{
        COMMIT_SIGNING_NAMESPACE, CommitSignError, CommitSignRequest, PEM_SIGNATURE_ENCODING,
        SSH_SIGNING_FORMAT, sign_commit_payload,
    };
    use ssh_key::{PublicKey, SshSig};

    const TEST_PRIVATE_KEY: &str = include_str!("../tests/fixtures/ed25519_private_key");

    #[test]
    fn signs_commit_payloads_as_pem_encoded_ssh_signatures() {
        let response = sign_commit_payload(&CommitSignRequest {
            format: SSH_SIGNING_FORMAT.to_string(),
            private_key: TEST_PRIVATE_KEY.to_string(),
            payload_base64: "Y29tbWl0IHBheWxvYWQ=".to_string(),
        })
        .expect("commit payload should sign");

        assert_eq!(response.format, SSH_SIGNING_FORMAT);
        assert_eq!(response.signature_encoding, PEM_SIGNATURE_ENCODING);
        assert!(
            response
                .signature
                .starts_with("-----BEGIN SSH SIGNATURE-----\n")
        );
        assert!(
            response
                .signature
                .ends_with("-----END SSH SIGNATURE-----\n")
        );

        let signature = response
            .signature
            .parse::<SshSig>()
            .expect("signature PEM should parse");
        let public_key = PublicKey::from_openssh(
            "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAILM+rvN+ot98qgEN796jTiQfZfG1KaT0PtFDJ/XFSqti user@example.com",
        )
        .expect("public key should parse");

        public_key
            .verify(COMMIT_SIGNING_NAMESPACE, b"commit payload", &signature)
            .expect("signature should verify against the commit payload");
    }

    #[test]
    fn rejects_unsupported_signing_formats() {
        let error = sign_commit_payload(&CommitSignRequest {
            format: "openpgp".to_string(),
            private_key: TEST_PRIVATE_KEY.to_string(),
            payload_base64: "Y29tbWl0IHBheWxvYWQ=".to_string(),
        })
        .expect_err("unsupported format should fail");

        assert!(matches!(error, CommitSignError::UnsupportedFormat(format) if format == "openpgp"));
    }

    #[test]
    fn rejects_encrypted_private_keys() {
        let encrypted_private_key = r#"-----BEGIN OPENSSH PRIVATE KEY-----
b3BlbnNzaC1rZXktdjEAAAAACmFlczI1Ni1jdHIAAAAGYmNyeXB0AAAAGAAAABBKH96ujW
umB6/WnTNPjTeaAAAAEAAAAAEAAAAzAAAAC3NzaC1lZDI1NTE5AAAAILM+rvN+ot98qgEN
796jTiQfZfG1KaT0PtFDJ/XFSqtiAAAAoFzvbvyFMhAiwBOXF0mhUUacPUCMZXivG2up2c
hEnAw1b6BLRPyWbY5cC2n9ggD4ivJ1zSts6sBgjyiXQAReyrP35myYvT/OIB/NpwZM/xIJ
N7MHSUzlkX4adBrga3f7GS4uv4ChOoxC4XsE5HsxtGsq1X8jzqLlZTmOcxkcEneYQexrUc
bQP0o+gL5aKK8cQgiIlXeDbRjqhc4+h4EF6lY=
-----END OPENSSH PRIVATE KEY-----"#;

        let error = sign_commit_payload(&CommitSignRequest {
            format: SSH_SIGNING_FORMAT.to_string(),
            private_key: encrypted_private_key.to_string(),
            payload_base64: "Y29tbWl0IHBheWxvYWQ=".to_string(),
        })
        .expect_err("encrypted SSH keys should fail fast");

        assert!(matches!(error, CommitSignError::EncryptedPrivateKey));
    }
}
