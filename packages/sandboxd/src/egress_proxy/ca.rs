use std::fs::{self, DirBuilder, OpenOptions};
use std::io::Write;
use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt};
use std::path::{Path, PathBuf};
use std::process::Command;

use serde_json::Value;

use crate::egress_proxy::{EgressProxyError, EgressProxyLogContext, emit_egress_proxy_log};
use crate::proxy_ca::{GeneratedProxyCa, generate_proxy_ca, validate_proxy_ca_material};
use crate::time::Clock;

#[derive(Clone, Copy)]
pub(super) struct ProxyCaConfig<'a> {
    pub(super) runtime_certificate_path: &'a Path,
    pub(super) runtime_certificate_bundle_path: &'a Path,
    pub(super) persistent_certificate_path: &'a Path,
    pub(super) persistent_private_key_path: &'a Path,
    pub(super) trust_store_certificate_path: &'a Path,
    pub(super) system_certificate_bundle_path: &'a Path,
    pub(super) refresh_command: &'a Path,
}

#[derive(Debug)]
pub(super) struct ProxyCaInstallation {
    pub(super) runtime_certificate_path: PathBuf,
    pub(super) runtime_certificate_bundle_path: PathBuf,
    pub(super) trust_store_certificate_path: PathBuf,
    pub(super) refresh_command: PathBuf,
}

impl ProxyCaInstallation {
    pub(super) fn install(
        proxy_ca_certificate_pem: &str,
        runtime_certificate_path: &Path,
        runtime_certificate_bundle_path: &Path,
        trust_store_certificate_path: &Path,
        system_certificate_bundle_path: &Path,
        refresh_command: &Path,
        log_context: EgressProxyLogContext<'_>,
    ) -> Result<Self, EgressProxyError> {
        emit_proxy_ca_lifecycle_log(
            log_context,
            "egress_proxy_ca_install_started",
            runtime_certificate_path,
            trust_store_certificate_path,
            refresh_command,
            None,
        );
        let runtime_directory = runtime_certificate_path.parent().ok_or_else(|| {
            EgressProxyError::new("egress proxy CA path must include a parent directory")
        })?;
        prepare_proxy_directory(runtime_directory)?;
        let runtime_bundle_directory =
            runtime_certificate_bundle_path.parent().ok_or_else(|| {
                EgressProxyError::new("egress proxy CA bundle path must include a parent directory")
            })?;
        prepare_proxy_directory(runtime_bundle_directory)?;

        let trust_store_directory = trust_store_certificate_path.parent().ok_or_else(|| {
            EgressProxyError::new("egress proxy trust store path must include a parent directory")
        })?;
        prepare_system_trust_store_directory(trust_store_directory)?;
        let system_certificate_bundle =
            fs::read(system_certificate_bundle_path).map_err(|error| {
                EgressProxyError::new(format!(
                    "failed to read system certificate bundle '{}': {error}",
                    system_certificate_bundle_path.display()
                ))
            })?;

        fs::write(
            runtime_certificate_path,
            proxy_ca_certificate_pem.as_bytes(),
        )
        .map_err(|error| {
            EgressProxyError::new(format!(
                "failed to write local egress proxy certificate '{}': {error}",
                runtime_certificate_path.display()
            ))
        })?;
        let runtime_certificate_bundle =
            build_combined_certificate_bundle(&system_certificate_bundle, proxy_ca_certificate_pem);
        fs::write(runtime_certificate_bundle_path, &runtime_certificate_bundle).map_err(
            |error| {
                EgressProxyError::new(format!(
                    "failed to write local egress proxy certificate bundle '{}': {error}",
                    runtime_certificate_bundle_path.display()
                ))
            },
        )?;
        fs::write(
            trust_store_certificate_path,
            proxy_ca_certificate_pem.as_bytes(),
        )
        .map_err(|error| {
            EgressProxyError::new(format!(
                "failed to write local egress proxy trust store certificate '{}': {error}",
                trust_store_certificate_path.display()
            ))
        })?;

        let installation = Self {
            runtime_certificate_path: runtime_certificate_path.to_path_buf(),
            runtime_certificate_bundle_path: runtime_certificate_bundle_path.to_path_buf(),
            trust_store_certificate_path: trust_store_certificate_path.to_path_buf(),
            refresh_command: refresh_command.to_path_buf(),
        };

        if let Err(error) = installation.refresh_system_trust_store() {
            let cleanup_error = installation.cleanup().err().map(|cleanup_error| {
                format!(" cleanup after trust store refresh failure also failed: {cleanup_error}")
            });
            let suffix = cleanup_error.unwrap_or_default();
            return Err(EgressProxyError::new(format!("{error}{suffix}")));
        }

        emit_proxy_ca_lifecycle_log(
            log_context,
            "egress_proxy_ca_install_completed",
            runtime_certificate_path,
            trust_store_certificate_path,
            refresh_command,
            None,
        );

        Ok(installation)
    }

    fn cleanup(&self) -> Result<(), EgressProxyError> {
        match fs::remove_file(&self.runtime_certificate_path) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => {
                return Err(EgressProxyError::new(format!(
                    "failed to remove local egress proxy certificate '{}': {error}",
                    self.runtime_certificate_path.display()
                )));
            }
        }
        match fs::remove_file(&self.runtime_certificate_bundle_path) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => {
                return Err(EgressProxyError::new(format!(
                    "failed to remove local egress proxy certificate bundle '{}': {error}",
                    self.runtime_certificate_bundle_path.display()
                )));
            }
        }

        Ok(())
    }

    fn refresh_system_trust_store(&self) -> Result<(), EgressProxyError> {
        run_update_ca_certificates(&self.refresh_command)
    }
}

pub(super) fn load_or_create_persistent_proxy_ca(
    proxy_ca_config: ProxyCaConfig<'_>,
    clock: &dyn Clock,
    _log_context: EgressProxyLogContext<'_>,
) -> Result<GeneratedProxyCa, EgressProxyError> {
    let certificate_exists = proxy_ca_config.persistent_certificate_path.exists();
    let private_key_exists = proxy_ca_config.persistent_private_key_path.exists();

    match (certificate_exists, private_key_exists) {
        (true, true) => load_persistent_proxy_ca(proxy_ca_config),
        (false, false) => {
            let generated_proxy_ca = generate_proxy_ca(clock)
                .map_err(|error| EgressProxyError::new(error.to_string()))?;
            write_persistent_proxy_ca(proxy_ca_config, &generated_proxy_ca)?;
            Ok(generated_proxy_ca)
        }
        (true, false) => Err(EgressProxyError::new(format!(
            "persistent egress proxy CA certificate exists at '{}' but private key is missing at '{}'",
            proxy_ca_config.persistent_certificate_path.display(),
            proxy_ca_config.persistent_private_key_path.display()
        ))),
        (false, true) => Err(EgressProxyError::new(format!(
            "persistent egress proxy CA private key exists at '{}' but certificate is missing at '{}'",
            proxy_ca_config.persistent_private_key_path.display(),
            proxy_ca_config.persistent_certificate_path.display()
        ))),
    }
}

fn load_persistent_proxy_ca(
    proxy_ca_config: ProxyCaConfig<'_>,
) -> Result<GeneratedProxyCa, EgressProxyError> {
    let generated_proxy_ca =
        GeneratedProxyCa {
            certificate_pem: fs::read_to_string(proxy_ca_config.persistent_certificate_path)
                .map_err(|error| {
                    EgressProxyError::new(format!(
                        "failed to read persistent egress proxy CA certificate '{}': {error}",
                        proxy_ca_config.persistent_certificate_path.display()
                    ))
                })?,
            private_key_pem: fs::read_to_string(proxy_ca_config.persistent_private_key_path)
                .map_err(|error| {
                    EgressProxyError::new(format!(
                        "failed to read persistent egress proxy CA private key '{}': {error}",
                        proxy_ca_config.persistent_private_key_path.display()
                    ))
                })?,
        };
    validate_proxy_ca_material(&generated_proxy_ca)
        .map_err(|error| EgressProxyError::new(error.to_string()))?;
    Ok(generated_proxy_ca)
}

fn write_persistent_proxy_ca(
    proxy_ca_config: ProxyCaConfig<'_>,
    generated_proxy_ca: &GeneratedProxyCa,
) -> Result<(), EgressProxyError> {
    let certificate_directory = proxy_ca_config
        .persistent_certificate_path
        .parent()
        .ok_or_else(|| {
            EgressProxyError::new("persistent egress proxy CA path must include a parent directory")
        })?;
    let private_key_directory = proxy_ca_config
        .persistent_private_key_path
        .parent()
        .ok_or_else(|| {
            EgressProxyError::new(
                "persistent egress proxy CA private-key path must include a parent directory",
            )
        })?;
    prepare_proxy_directory(certificate_directory)?;
    prepare_proxy_directory(private_key_directory)?;
    validate_proxy_ca_material(generated_proxy_ca)
        .map_err(|error| EgressProxyError::new(error.to_string()))?;

    write_new_file(
        proxy_ca_config.persistent_certificate_path,
        generated_proxy_ca.certificate_pem.as_bytes(),
        0o644,
        "persistent egress proxy CA certificate",
    )?;
    if let Err(error) = write_new_file(
        proxy_ca_config.persistent_private_key_path,
        generated_proxy_ca.private_key_pem.as_bytes(),
        0o600,
        "persistent egress proxy CA private key",
    ) {
        let _ = fs::remove_file(proxy_ca_config.persistent_certificate_path);
        return Err(error);
    }
    Ok(())
}

fn write_new_file(
    path: &Path,
    contents: &[u8],
    mode: u32,
    description: &str,
) -> Result<(), EgressProxyError> {
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(mode)
        .open(path)
        .map_err(|error| {
            EgressProxyError::new(format!(
                "failed to create {description} '{}': {error}",
                path.display()
            ))
        })?;
    file.write_all(contents).map_err(|error| {
        EgressProxyError::new(format!(
            "failed to write {description} '{}': {error}",
            path.display()
        ))
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

fn prepare_system_trust_store_directory(path: &Path) -> Result<(), EgressProxyError> {
    fs::create_dir_all(path).map_err(|error| {
        EgressProxyError::new(format!(
            "failed to create system trust store directory '{}': {error}",
            path.display()
        ))
    })
}

fn build_combined_certificate_bundle(
    system_certificate_bundle: &[u8],
    proxy_ca_certificate_pem: &str,
) -> Vec<u8> {
    let mut combined_bundle =
        Vec::with_capacity(system_certificate_bundle.len() + proxy_ca_certificate_pem.len() + 1);
    combined_bundle.extend_from_slice(system_certificate_bundle);
    if !combined_bundle.ends_with(b"\n") {
        combined_bundle.push(b'\n');
    }
    combined_bundle.extend_from_slice(proxy_ca_certificate_pem.as_bytes());
    combined_bundle
}

fn run_update_ca_certificates(command_path: &Path) -> Result<(), EgressProxyError> {
    let output = Command::new(command_path).output().map_err(|error| {
        EgressProxyError::new(format!(
            "failed to run '{}' to refresh the system trust store: {error}",
            command_path.display()
        ))
    })?;
    if output.status.success() {
        return Ok(());
    }

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let mut output_parts = Vec::new();
    if !stdout.is_empty() {
        output_parts.push(format!("stdout={stdout}"));
    }
    if !stderr.is_empty() {
        output_parts.push(format!("stderr={stderr}"));
    }
    let output_suffix = if output_parts.is_empty() {
        String::new()
    } else {
        format!(" ({})", output_parts.join(" "))
    };

    Err(EgressProxyError::new(format!(
        "'{}' failed while refreshing the system trust store with status {}{}",
        command_path.display(),
        output
            .status
            .code()
            .map_or_else(|| "signal".to_string(), |code| code.to_string()),
        output_suffix
    )))
}

pub(super) fn emit_proxy_ca_lifecycle_log(
    log_context: EgressProxyLogContext<'_>,
    event: &str,
    runtime_certificate_path: &Path,
    trust_store_certificate_path: &Path,
    refresh_command: &Path,
    error: Option<String>,
) {
    let mut fields = vec![
        (
            "runtimeCertificatePath",
            Value::String(runtime_certificate_path.display().to_string()),
        ),
        (
            "trustStoreCertificatePath",
            Value::String(trust_store_certificate_path.display().to_string()),
        ),
        (
            "refreshCommand",
            Value::String(refresh_command.display().to_string()),
        ),
    ];
    if let Some(error) = error {
        fields.push(("error", Value::String(error)));
    }
    emit_egress_proxy_log(
        log_context.clock,
        log_context.sandbox_instance_id,
        event,
        &fields,
    );
}

pub(super) fn cleanup_proxy_ca_installation(
    installation: &ProxyCaInstallation,
    log_context: EgressProxyLogContext<'_>,
) -> Result<(), EgressProxyError> {
    emit_proxy_ca_lifecycle_log(
        log_context,
        "egress_proxy_ca_cleanup_started",
        &installation.runtime_certificate_path,
        &installation.trust_store_certificate_path,
        &installation.refresh_command,
        None,
    );
    match installation.cleanup() {
        Ok(()) => {
            emit_proxy_ca_lifecycle_log(
                log_context,
                "egress_proxy_ca_cleanup_completed",
                &installation.runtime_certificate_path,
                &installation.trust_store_certificate_path,
                &installation.refresh_command,
                None,
            );
            Ok(())
        }
        Err(error) => {
            emit_proxy_ca_lifecycle_log(
                log_context,
                "egress_proxy_ca_cleanup_failed",
                &installation.runtime_certificate_path,
                &installation.trust_store_certificate_path,
                &installation.refresh_command,
                Some(error.to_string()),
            );
            Err(error)
        }
    }
}
