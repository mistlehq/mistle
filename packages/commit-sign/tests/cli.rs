use commit_sign::{
    COMMIT_SIGNING_NAMESPACE, CommitSignResponse, PEM_SIGNATURE_ENCODING, SSH_SIGNING_FORMAT,
};
use serde_json::json;
use ssh_key::{PublicKey, SshSig};
use std::io::Write;
use std::process::{Command, Stdio};

const TEST_PRIVATE_KEY: &str = include_str!("./fixtures/ed25519_private_key");

#[test]
fn cli_signs_commit_payloads_from_json_stdin() {
    let mut child = Command::new(env!("CARGO_BIN_EXE_commit-sign"))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("commit-sign binary should spawn");

    {
        let stdin = child.stdin.as_mut().expect("stdin should be available");
        stdin
            .write_all(
                json!({
                    "format": "ssh",
                    "privateKey": TEST_PRIVATE_KEY,
                    "payloadBase64": "Y29tbWl0IHBheWxvYWQ="
                })
                .to_string()
                .as_bytes(),
            )
            .expect("request should write");
    }

    let output = child
        .wait_with_output()
        .expect("commit-sign binary should finish");

    assert!(
        output.status.success(),
        "stderr: {}",
        String::from_utf8_lossy(&output.stderr)
    );

    let response = serde_json::from_slice::<CommitSignResponse>(&output.stdout)
        .expect("stdout should contain JSON");
    assert_eq!(response.format, SSH_SIGNING_FORMAT);
    assert_eq!(response.signature_encoding, PEM_SIGNATURE_ENCODING);

    let signature = response
        .signature
        .parse::<SshSig>()
        .expect("signature should parse");
    let public_key = PublicKey::from_openssh(
        "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAILM+rvN+ot98qgEN796jTiQfZfG1KaT0PtFDJ/XFSqti user@example.com",
    )
    .expect("public key should parse");
    public_key
        .verify(COMMIT_SIGNING_NAMESPACE, b"commit payload", &signature)
        .expect("signature should verify");
}

#[test]
fn cli_reports_unsupported_formats_on_stderr() {
    let mut child = Command::new(env!("CARGO_BIN_EXE_commit-sign"))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("commit-sign binary should spawn");

    {
        let stdin = child.stdin.as_mut().expect("stdin should be available");
        stdin
            .write_all(
                json!({
                    "format": "openpgp",
                    "privateKey": TEST_PRIVATE_KEY,
                    "payloadBase64": "Y29tbWl0IHBheWxvYWQ="
                })
                .to_string()
                .as_bytes(),
            )
            .expect("request should write");
    }

    let output = child
        .wait_with_output()
        .expect("commit-sign binary should finish");

    assert!(!output.status.success());
    assert_eq!(String::from_utf8_lossy(&output.stdout), "");
    assert!(
        String::from_utf8_lossy(&output.stderr)
            .contains("unsupported commit signing format: openpgp")
    );
}
