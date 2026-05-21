use std::fs;
use std::path::Path;

const SNAPSHOT_RUNTIME_ARTIFACTS_DIRECTORY: &str = "/run/mistle";
const SNAPSHOT_TRUST_STORE_CERT_PATH: &str =
    "/usr/local/share/ca-certificates/mistle-egress-proxy-ca.crt";

pub(super) fn scrub_snapshot_runtime_artifacts() -> Result<(), String> {
    scrub_snapshot_runtime_artifacts_at_paths(
        Path::new(SNAPSHOT_RUNTIME_ARTIFACTS_DIRECTORY),
        Path::new(SNAPSHOT_TRUST_STORE_CERT_PATH),
    )
}

fn scrub_snapshot_runtime_artifacts_at_paths(
    runtime_artifacts_directory: &Path,
    trust_store_certificate_path: &Path,
) -> Result<(), String> {
    match fs::remove_dir_all(runtime_artifacts_directory) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => {
            return Err(format!(
                "failed to remove snapshot runtime artifacts directory '{}': {error}",
                runtime_artifacts_directory.display()
            ));
        }
    }

    match fs::remove_file(trust_store_certificate_path) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => {
            return Err(format!(
                "failed to remove snapshot trust-store certificate '{}': {error}",
                trust_store_certificate_path.display()
            ));
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use std::time::{SystemTime, UNIX_EPOCH};

    use crate::sandboxd_state::snapshot::scrub_snapshot_runtime_artifacts_at_paths;

    #[test]
    fn scrub_snapshot_runtime_artifacts_removes_runtime_directory_and_trust_store_file() {
        let unique_suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be after unix epoch")
            .as_nanos();
        let temp_root =
            std::env::temp_dir().join(format!("mistle-snapshot-runtime-artifacts-{unique_suffix}"));
        let runtime_directory = temp_root.join("run/mistle");
        let trust_store_certificate_path =
            temp_root.join("usr/local/share/ca-certificates/mistle-egress-proxy-ca.crt");

        std::fs::create_dir_all(runtime_directory.join("sandboxd"))
            .expect("runtime directory should be creatable");
        std::fs::create_dir_all(
            trust_store_certificate_path
                .parent()
                .expect("trust store path should have a parent"),
        )
        .expect("trust store directory should be creatable");
        std::fs::write(runtime_directory.join("init.log"), "diagnostics")
            .expect("runtime diagnostics file should be writable");
        std::fs::write(&trust_store_certificate_path, "cert")
            .expect("trust store certificate should be writable");

        scrub_snapshot_runtime_artifacts_at_paths(
            &runtime_directory,
            &trust_store_certificate_path,
        )
        .expect("snapshot runtime artifacts should scrub cleanly");

        assert!(!runtime_directory.exists());
        assert!(!trust_store_certificate_path.exists());
        std::fs::remove_dir_all(&temp_root).ok();
    }
}
