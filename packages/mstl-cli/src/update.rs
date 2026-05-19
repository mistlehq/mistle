use std::cmp::Ordering;
use std::env;
use std::fmt;
use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

use sha2::{Digest, Sha256};

const GITHUB_RELEASE_DOWNLOAD_BASE_URL: &str =
    "https://github.com/mistlehq/mistle/releases/latest/download";

pub(crate) fn run<W, E>(stdout: &mut W, stderr: &mut E) -> i32
where
    W: Write,
    E: Write,
{
    match update_current_executable() {
        Ok(UpdateOutcome::AlreadyUpToDate { version }) => {
            match writeln!(stdout, "Mistle CLI is already up to date ({version}).") {
                Ok(()) => 0,
                Err(error) => {
                    let _ = writeln!(stderr, "failed to write update status: {error}");
                    1
                }
            }
        }
        Ok(UpdateOutcome::Updated {
            previous_version,
            updated_version,
            executable_path,
        }) => {
            match writeln!(
                stdout,
                "Updated Mistle CLI from {previous_version} to {updated_version}: {}",
                executable_path.display()
            ) {
                Ok(()) => 0,
                Err(error) => {
                    let _ = writeln!(stderr, "failed to write update status: {error}");
                    1
                }
            }
        }
        Err(error) => {
            let _ = writeln!(stderr, "{error}");
            1
        }
    }
}

fn update_current_executable() -> Result<UpdateOutcome, UpdateError> {
    let target = release_target()?;
    let asset_name = release_asset_name(target);
    let asset_url = latest_release_asset_url(&asset_name);
    let checksum_url = latest_release_asset_url(&format!("{asset_name}.sha256"));
    let current_version = env!("CARGO_PKG_VERSION");
    let executable_path = env::current_exe().map_err(UpdateError::ResolveCurrentExecutable)?;
    let downloaded_binary = download_release_asset(&asset_url)?;
    let expected_checksum = download_release_checksum(&checksum_url)?;
    let actual_checksum = sha256_hex(&downloaded_binary);

    if actual_checksum != expected_checksum {
        return Err(UpdateError::ChecksumMismatch {
            asset_url,
            expected: expected_checksum,
            actual: actual_checksum,
        });
    }

    let temporary_binary_path = temporary_binary_path(&executable_path)?;
    write_downloaded_binary(&temporary_binary_path, &downloaded_binary)?;
    if let Err(error) = set_executable_permissions(&temporary_binary_path) {
        let _ = fs::remove_file(&temporary_binary_path);
        return Err(error);
    }

    let downloaded_version = match read_binary_version(&temporary_binary_path) {
        Ok(version) => version,
        Err(error) => {
            let _ = fs::remove_file(&temporary_binary_path);
            return Err(error);
        }
    };
    let version_order = match compare_versions(&downloaded_version, current_version) {
        Ok(version_order) => version_order,
        Err(error) => {
            let _ = fs::remove_file(&temporary_binary_path);
            return Err(error);
        }
    };

    match version_order {
        Ordering::Equal => {
            fs::remove_file(&temporary_binary_path).map_err(|source| UpdateError::RemoveFile {
                path: temporary_binary_path,
                source,
            })?;
            Ok(UpdateOutcome::AlreadyUpToDate {
                version: current_version.to_owned(),
            })
        }
        Ordering::Less => {
            fs::remove_file(&temporary_binary_path).map_err(|source| UpdateError::RemoveFile {
                path: temporary_binary_path,
                source,
            })?;
            Err(UpdateError::DownloadedVersionIsOlder {
                current_version: current_version.to_owned(),
                downloaded_version,
            })
        }
        Ordering::Greater => {
            if let Err(error) = replace_current_executable(&temporary_binary_path, &executable_path)
            {
                let _ = fs::remove_file(&temporary_binary_path);
                return Err(error);
            }

            Ok(UpdateOutcome::Updated {
                previous_version: current_version.to_owned(),
                updated_version: downloaded_version,
                executable_path,
            })
        }
    }
}

fn release_target() -> Result<&'static str, UpdateError> {
    match (env::consts::OS, env::consts::ARCH) {
        ("linux", "x86_64") => Ok("x86_64-unknown-linux-gnu"),
        ("linux", "aarch64") => Ok("aarch64-unknown-linux-gnu"),
        ("macos", "x86_64") => Ok("x86_64-apple-darwin"),
        ("macos", "aarch64") => Ok("aarch64-apple-darwin"),
        (os, arch) => Err(UpdateError::UnsupportedPlatform { os, arch }),
    }
}

fn release_asset_name(target: &str) -> String {
    format!("mistle-cli-{target}")
}

fn latest_release_asset_url(asset_name: &str) -> String {
    format!("{GITHUB_RELEASE_DOWNLOAD_BASE_URL}/{asset_name}")
}

fn download_release_asset(url: &str) -> Result<Vec<u8>, UpdateError> {
    let mut response = ureq::get(url)
        .call()
        .map_err(|source| UpdateError::Request {
            url: url.to_owned(),
            source,
        })?;

    response
        .body_mut()
        .read_to_vec()
        .map_err(|source| UpdateError::ReadResponse {
            url: url.to_owned(),
            source,
        })
}

fn download_release_checksum(url: &str) -> Result<String, UpdateError> {
    let mut response = ureq::get(url)
        .call()
        .map_err(|source| UpdateError::Request {
            url: url.to_owned(),
            source,
        })?;
    let checksum_file =
        response
            .body_mut()
            .read_to_string()
            .map_err(|source| UpdateError::ReadResponse {
                url: url.to_owned(),
                source,
            })?;
    let checksum = checksum_file.split_whitespace().next().ok_or_else(|| {
        UpdateError::InvalidChecksumFile {
            url: url.to_owned(),
        }
    })?;

    if !is_sha256_hex(checksum) {
        return Err(UpdateError::InvalidChecksumFile {
            url: url.to_owned(),
        });
    }

    Ok(checksum.to_owned())
}

fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    let mut output = String::with_capacity(digest.len() * 2);
    const HEX: &[u8; 16] = b"0123456789abcdef";

    for byte in digest {
        output.push(HEX[(byte >> 4) as usize] as char);
        output.push(HEX[(byte & 0x0f) as usize] as char);
    }

    output
}

fn is_sha256_hex(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn temporary_binary_path(executable_path: &Path) -> Result<PathBuf, UpdateError> {
    let executable_directory =
        executable_path
            .parent()
            .ok_or_else(|| UpdateError::MissingExecutableDirectory {
                path: executable_path.to_path_buf(),
            })?;
    let timestamp_nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(UpdateError::SystemTime)?
        .as_nanos();

    Ok(executable_directory.join(format!(
        ".mistle-update-{}-{timestamp_nanos}",
        std::process::id()
    )))
}

fn write_downloaded_binary(path: &Path, binary: &[u8]) -> Result<(), UpdateError> {
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|source| UpdateError::WriteFile {
            path: path.to_path_buf(),
            source,
        })?;

    file.write_all(binary)
        .map_err(|source| UpdateError::WriteFile {
            path: path.to_path_buf(),
            source,
        })?;
    file.sync_all().map_err(|source| UpdateError::WriteFile {
        path: path.to_path_buf(),
        source,
    })
}

#[cfg(unix)]
fn set_executable_permissions(path: &Path) -> Result<(), UpdateError> {
    use std::os::unix::fs::PermissionsExt;

    let mut permissions = fs::metadata(path)
        .map_err(|source| UpdateError::ReadFileMetadata {
            path: path.to_path_buf(),
            source,
        })?
        .permissions();
    permissions.set_mode(0o755);
    fs::set_permissions(path, permissions).map_err(|source| UpdateError::SetFilePermissions {
        path: path.to_path_buf(),
        source,
    })
}

#[cfg(not(unix))]
fn set_executable_permissions(_path: &Path) -> Result<(), UpdateError> {
    Ok(())
}

fn read_binary_version(path: &Path) -> Result<String, UpdateError> {
    let output = Command::new(path)
        .arg("--version")
        .output()
        .map_err(|source| UpdateError::RunDownloadedBinary {
            path: path.to_path_buf(),
            source,
        })?;

    if !output.status.success() {
        return Err(UpdateError::DownloadedBinaryVersionFailed {
            path: path.to_path_buf(),
            stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
        });
    }

    parse_version_output(&output.stdout).ok_or_else(|| UpdateError::InvalidDownloadedVersion {
        path: path.to_path_buf(),
        stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
    })
}

fn parse_version_output(stdout: &[u8]) -> Option<String> {
    let output = String::from_utf8_lossy(stdout);
    let first_line = output.lines().next()?;
    let version = first_line.strip_prefix("Version: ")?;

    if version.trim() == version && !version.is_empty() {
        Some(version.to_owned())
    } else {
        None
    }
}

fn compare_versions(left: &str, right: &str) -> Result<Ordering, UpdateError> {
    let left = ReleaseVersion::parse(left).ok_or_else(|| UpdateError::InvalidVersion {
        version: left.to_owned(),
    })?;
    let right = ReleaseVersion::parse(right).ok_or_else(|| UpdateError::InvalidVersion {
        version: right.to_owned(),
    })?;

    Ok(left.cmp(&right))
}

fn replace_current_executable(
    temporary_path: &Path,
    executable_path: &Path,
) -> Result<(), UpdateError> {
    fs::rename(temporary_path, executable_path).map_err(|source| UpdateError::ReplaceExecutable {
        path: executable_path.to_path_buf(),
        source,
    })
}

#[derive(Debug, Eq, PartialEq)]
struct ReleaseVersion<'a> {
    major: u64,
    minor: u64,
    patch: u64,
    prerelease: Option<&'a str>,
}

impl<'a> ReleaseVersion<'a> {
    fn parse(value: &'a str) -> Option<Self> {
        let (version, prerelease) = match value.split_once('-') {
            Some((version, prerelease)) if !prerelease.is_empty() => (version, Some(prerelease)),
            Some(_) => return None,
            None => (value, None),
        };
        let mut parts = version.split('.');
        let major = parts.next()?.parse().ok()?;
        let minor = parts.next()?.parse().ok()?;
        let patch = parts.next()?.parse().ok()?;

        if parts.next().is_some() {
            return None;
        }

        Some(Self {
            major,
            minor,
            patch,
            prerelease,
        })
    }
}

impl Ord for ReleaseVersion<'_> {
    fn cmp(&self, other: &Self) -> Ordering {
        match (self.major, self.minor, self.patch).cmp(&(other.major, other.minor, other.patch)) {
            Ordering::Equal => match (self.prerelease, other.prerelease) {
                (None, None) => Ordering::Equal,
                (None, Some(_)) => Ordering::Greater,
                (Some(_), None) => Ordering::Less,
                (Some(left), Some(right)) => left.cmp(right),
            },
            ordering => ordering,
        }
    }
}

impl PartialOrd for ReleaseVersion<'_> {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

enum UpdateOutcome {
    AlreadyUpToDate {
        version: String,
    },
    Updated {
        previous_version: String,
        updated_version: String,
        executable_path: PathBuf,
    },
}

#[derive(Debug)]
enum UpdateError {
    UnsupportedPlatform {
        os: &'static str,
        arch: &'static str,
    },
    Request {
        url: String,
        source: ureq::Error,
    },
    ReadResponse {
        url: String,
        source: ureq::Error,
    },
    InvalidChecksumFile {
        url: String,
    },
    ChecksumMismatch {
        asset_url: String,
        expected: String,
        actual: String,
    },
    ResolveCurrentExecutable(io::Error),
    MissingExecutableDirectory {
        path: PathBuf,
    },
    SystemTime(std::time::SystemTimeError),
    WriteFile {
        path: PathBuf,
        source: io::Error,
    },
    ReadFileMetadata {
        path: PathBuf,
        source: io::Error,
    },
    SetFilePermissions {
        path: PathBuf,
        source: io::Error,
    },
    RunDownloadedBinary {
        path: PathBuf,
        source: io::Error,
    },
    DownloadedBinaryVersionFailed {
        path: PathBuf,
        stderr: String,
    },
    InvalidDownloadedVersion {
        path: PathBuf,
        stdout: String,
    },
    InvalidVersion {
        version: String,
    },
    DownloadedVersionIsOlder {
        current_version: String,
        downloaded_version: String,
    },
    ReplaceExecutable {
        path: PathBuf,
        source: io::Error,
    },
    RemoveFile {
        path: PathBuf,
        source: io::Error,
    },
}

impl fmt::Display for UpdateError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::UnsupportedPlatform { os, arch } => {
                write!(
                    formatter,
                    "unsupported platform for Mistle CLI updates: {os} {arch}"
                )
            }
            Self::Request { url, source } => {
                write!(formatter, "failed to download `{url}`: {source}")
            }
            Self::ReadResponse { url, source } => {
                write!(
                    formatter,
                    "failed to read download response from `{url}`: {source}"
                )
            }
            Self::InvalidChecksumFile { url } => {
                write!(
                    formatter,
                    "release checksum file `{url}` did not contain a SHA-256 checksum"
                )
            }
            Self::ChecksumMismatch {
                asset_url,
                expected,
                actual,
            } => write!(
                formatter,
                "checksum verification failed for `{asset_url}`: expected {expected}, got {actual}"
            ),
            Self::ResolveCurrentExecutable(source) => {
                write!(
                    formatter,
                    "failed to resolve current executable path: {source}"
                )
            }
            Self::MissingExecutableDirectory { path } => {
                write!(
                    formatter,
                    "current executable path `{}` has no parent directory",
                    path.display()
                )
            }
            Self::SystemTime(source) => {
                write!(
                    formatter,
                    "failed to generate temporary update path: {source}"
                )
            }
            Self::WriteFile { path, source } => write_file_error(formatter, "write", path, source),
            Self::ReadFileMetadata { path, source } => {
                write!(
                    formatter,
                    "failed to read metadata for `{}`: {source}",
                    path.display()
                )
            }
            Self::SetFilePermissions { path, source } => {
                write!(
                    formatter,
                    "failed to set executable permissions on `{}`: {source}",
                    path.display()
                )
            }
            Self::RunDownloadedBinary { path, source } => {
                write!(
                    formatter,
                    "failed to run downloaded Mistle CLI `{}`: {source}",
                    path.display()
                )
            }
            Self::DownloadedBinaryVersionFailed { path, stderr } => write!(
                formatter,
                "downloaded Mistle CLI `{}` failed its version check: {}",
                path.display(),
                stderr.trim()
            ),
            Self::InvalidDownloadedVersion { path, stdout } => write!(
                formatter,
                "downloaded Mistle CLI `{}` printed an invalid version: {}",
                path.display(),
                stdout.trim()
            ),
            Self::InvalidVersion { version } => {
                write!(formatter, "invalid Mistle CLI version `{version}`")
            }
            Self::DownloadedVersionIsOlder {
                current_version,
                downloaded_version,
            } => write!(
                formatter,
                "downloaded Mistle CLI version {downloaded_version} is older than current version {current_version}"
            ),
            Self::ReplaceExecutable { path, source } => {
                write_file_error(formatter, "update", path, source)
            }
            Self::RemoveFile { path, source } => {
                write!(
                    formatter,
                    "failed to remove temporary update file `{}`: {source}",
                    path.display()
                )
            }
        }
    }
}

impl std::error::Error for UpdateError {}

fn write_file_error(
    formatter: &mut fmt::Formatter<'_>,
    action: &str,
    path: &Path,
    source: &io::Error,
) -> fmt::Result {
    if source.kind() == io::ErrorKind::PermissionDenied {
        write!(
            formatter,
            "failed to {action} `{}`: permission denied (install Mistle CLI in a user-writable directory or rerun with elevated permissions)",
            path.display()
        )
    } else {
        write!(
            formatter,
            "failed to {action} `{}`: {source}",
            path.display()
        )
    }
}

#[cfg(test)]
mod tests {
    use super::{compare_versions, is_sha256_hex, parse_version_output, release_asset_name};
    use std::cmp::Ordering;

    #[test]
    fn release_asset_name_uses_the_release_target() {
        assert_eq!(
            release_asset_name("x86_64-unknown-linux-gnu"),
            "mistle-cli-x86_64-unknown-linux-gnu"
        );
    }

    #[test]
    fn parses_bpaf_version_output() {
        assert_eq!(
            parse_version_output(b"Version: 0.18.0\n\n").as_deref(),
            Some("0.18.0")
        );
    }

    #[test]
    fn rejects_invalid_version_output() {
        assert_eq!(parse_version_output(b"mistle 0.18.0\n").as_deref(), None);
    }

    #[test]
    fn compares_release_versions() {
        assert_eq!(
            compare_versions("0.18.1", "0.18.0").unwrap(),
            Ordering::Greater
        );
        assert_eq!(
            compare_versions("0.18.0", "0.18.0").unwrap(),
            Ordering::Equal
        );
        assert_eq!(
            compare_versions("0.18.0", "0.18.1").unwrap(),
            Ordering::Less
        );
        assert_eq!(
            compare_versions("0.18.0", "0.18.0-alpha.1").unwrap(),
            Ordering::Greater
        );
    }

    #[test]
    fn validates_sha256_hex() {
        assert!(is_sha256_hex(
            "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
        ));
        assert!(!is_sha256_hex("not-a-checksum"));
    }
}
