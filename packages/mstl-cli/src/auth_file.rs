use std::env::{self, VarError};
use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::CliError;

const AUTH_FILE_NAME: &str = "auth.json";
const CONFIG_DIR_NAME: &str = "mistle";

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AuthFile {
    pub auth_mode: AuthMode,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub api_key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub oauth: Option<OAuthAuth>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OAuthAuth {
    pub access_token: String,
    pub refresh_token: String,
    #[serde(rename = "expiresAt")]
    pub expires_at_unix_seconds: u64,
    pub scope: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum AuthMode {
    ApiKey,
    Oauth,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum AuthCredential {
    ApiKey(String),
    OAuth(OAuthAuth),
}

pub(crate) fn read_auth_credential() -> Result<AuthCredential, CliError> {
    let auth_file_path = default_auth_file_path()?;
    read_auth_credential_from_path(&auth_file_path)
}

pub(crate) fn write_oauth(oauth: OAuthAuth) -> Result<PathBuf, CliError> {
    let auth_file_path = default_auth_file_path()?;
    write_auth_file_to_path(
        &auth_file_path,
        AuthFile {
            auth_mode: AuthMode::Oauth,
            api_key: None,
            oauth: Some(oauth),
        },
    )?;
    Ok(auth_file_path)
}

pub(crate) fn remove_auth_file() -> Result<Option<PathBuf>, CliError> {
    let auth_file_path = default_auth_file_path()?;

    match fs::remove_file(&auth_file_path) {
        Ok(()) => Ok(Some(auth_file_path)),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(source) => Err(CliError::RemoveAuthFile {
            path: auth_file_path.display().to_string(),
            source,
        }),
    }
}

fn read_auth_credential_from_path(path: &Path) -> Result<AuthCredential, CliError> {
    let contents = fs::read_to_string(path).map_err(|source| match source.kind() {
        io::ErrorKind::NotFound => CliError::MissingAuthFile,
        _ => CliError::ReadAuthFile {
            path: path.display().to_string(),
            source,
        },
    })?;

    let auth_file =
        serde_json::from_str::<AuthFile>(&contents).map_err(|source| CliError::ParseAuthFile {
            path: path.display().to_string(),
            source,
        })?;

    match auth_file.auth_mode {
        AuthMode::ApiKey => {
            let api_key = required_trimmed_field(path, auth_file.api_key, "apiKey")?;
            Ok(AuthCredential::ApiKey(api_key))
        }
        AuthMode::Oauth => {
            let oauth = auth_file.oauth.ok_or_else(|| CliError::InvalidAuthFile {
                path: path.display().to_string(),
                message: "oauth is required when authMode is oauth",
            })?;
            validate_required_field(path, &oauth.access_token, "oauth.accessToken")?;
            validate_required_field(path, &oauth.refresh_token, "oauth.refreshToken")?;
            validate_required_field(path, &oauth.scope, "oauth.scope")?;
            Ok(AuthCredential::OAuth(oauth))
        }
    }
}

#[cfg(test)]
fn write_api_key_to_path(path: &Path, api_key: &str) -> Result<(), CliError> {
    let trimmed_api_key = api_key.trim();
    if trimmed_api_key.is_empty() {
        return Err(CliError::InvalidAuthFile {
            path: path.display().to_string(),
            message: "apiKey cannot be blank",
        });
    }

    let parent = path.parent().ok_or_else(|| CliError::InvalidAuthFile {
        path: path.display().to_string(),
        message: "auth file path must have a parent directory",
    })?;
    fs::create_dir_all(parent).map_err(|source| CliError::CreateAuthDirectory {
        path: parent.display().to_string(),
        source,
    })?;

    let auth_file = AuthFile {
        auth_mode: AuthMode::ApiKey,
        api_key: Some(trimmed_api_key.to_owned()),
        oauth: None,
    };
    write_auth_file_to_path(path, auth_file)
}

fn write_auth_file_to_path(path: &Path, auth_file: AuthFile) -> Result<(), CliError> {
    let parent = path.parent().ok_or_else(|| CliError::InvalidAuthFile {
        path: path.display().to_string(),
        message: "auth file path must have a parent directory",
    })?;
    fs::create_dir_all(parent).map_err(|source| CliError::CreateAuthDirectory {
        path: parent.display().to_string(),
        source,
    })?;

    let serialized = serde_json::to_string_pretty(&auth_file)
        .map_err(|source| CliError::SerializeAuthFile { source })?;

    let mut options = OpenOptions::new();
    options.create(true).truncate(true).write(true);
    configure_auth_file_permissions(&mut options);

    let mut file = options
        .open(path)
        .map_err(|source| CliError::WriteAuthFile {
            path: path.display().to_string(),
            source,
        })?;
    file.write_all(serialized.as_bytes())
        .and_then(|()| file.write_all(b"\n"))
        .map_err(|source| CliError::WriteAuthFile {
            path: path.display().to_string(),
            source,
        })?;

    set_auth_file_permissions(path).map_err(|source| CliError::WriteAuthFile {
        path: path.display().to_string(),
        source,
    })
}

fn required_trimmed_field(
    path: &Path,
    value: Option<String>,
    field_name: &'static str,
) -> Result<String, CliError> {
    let value = value.ok_or_else(|| CliError::InvalidAuthFile {
        path: path.display().to_string(),
        message: field_required_message(field_name),
    })?;
    validate_required_field(path, &value, field_name)?;
    Ok(value.trim().to_owned())
}

fn validate_required_field(
    path: &Path,
    value: &str,
    field_name: &'static str,
) -> Result<(), CliError> {
    if value.trim().is_empty() {
        return Err(CliError::InvalidAuthFile {
            path: path.display().to_string(),
            message: field_blank_message(field_name),
        });
    }

    Ok(())
}

fn field_required_message(field_name: &'static str) -> &'static str {
    match field_name {
        "apiKey" => "apiKey is required when authMode is api_key",
        _ => "required auth field is missing",
    }
}

fn field_blank_message(field_name: &'static str) -> &'static str {
    match field_name {
        "apiKey" => "apiKey cannot be blank",
        "oauth.accessToken" => "oauth.accessToken cannot be blank",
        "oauth.refreshToken" => "oauth.refreshToken cannot be blank",
        "oauth.scope" => "oauth.scope cannot be blank",
        _ => "auth field cannot be blank",
    }
}

#[cfg(unix)]
fn configure_auth_file_permissions(options: &mut OpenOptions) {
    use std::os::unix::fs::OpenOptionsExt;

    options.mode(0o600);
}

#[cfg(not(unix))]
fn configure_auth_file_permissions(_options: &mut OpenOptions) {}

#[cfg(unix)]
fn set_auth_file_permissions(path: &Path) -> io::Result<()> {
    use std::os::unix::fs::PermissionsExt;

    let permissions = fs::Permissions::from_mode(0o600);
    fs::set_permissions(path, permissions)
}

#[cfg(not(unix))]
fn set_auth_file_permissions(_path: &Path) -> io::Result<()> {
    Ok(())
}

fn default_auth_file_path() -> Result<PathBuf, CliError> {
    Ok(default_config_home()?
        .join(CONFIG_DIR_NAME)
        .join(AUTH_FILE_NAME))
}

fn default_config_home() -> Result<PathBuf, CliError> {
    match env::var_os("XDG_CONFIG_HOME") {
        Some(value) if value.is_empty() => Err(CliError::BlankEnvironmentVariable {
            name: "XDG_CONFIG_HOME",
        }),
        Some(value) => Ok(PathBuf::from(value)),
        None => home_config_dir(),
    }
}

fn home_config_dir() -> Result<PathBuf, CliError> {
    match env::var("HOME") {
        Ok(value) if value.trim().is_empty() => {
            Err(CliError::BlankEnvironmentVariable { name: "HOME" })
        }
        Ok(value) => Ok(PathBuf::from(value).join(".config")),
        Err(VarError::NotPresent) => Err(CliError::MissingEnvironmentVariable { name: "HOME" }),
        Err(VarError::NotUnicode(_)) => {
            Err(CliError::NonUnicodeEnvironmentVariable { name: "HOME" })
        }
    }
}

#[cfg(test)]
mod tests {
    use std::fs;

    use crate::auth_file::{AuthCredential, read_auth_credential_from_path, write_api_key_to_path};

    #[test]
    fn reads_human_editable_api_key_auth_file() {
        let path = temp_auth_file_path("read");
        fs::write(
            &path,
            r#"{
  "authMode": "api_key",
  "apiKey": "mstl_apk_test"
}
"#,
        )
        .expect("write auth file");

        let credential = read_auth_credential_from_path(&path).expect("read api key");

        assert_eq!(
            credential,
            AuthCredential::ApiKey("mstl_apk_test".to_owned())
        );
    }

    #[test]
    fn rejects_blank_api_key_auth_file() {
        let path = temp_auth_file_path("blank");
        fs::write(
            &path,
            r#"{
  "authMode": "api_key",
  "apiKey": " "
}
"#,
        )
        .expect("write auth file");

        let error = read_auth_credential_from_path(&path).expect_err("blank api key should fail");

        assert_eq!(
            error.to_string(),
            format!(
                "invalid auth file `{}`: apiKey cannot be blank",
                path.display()
            )
        );
    }

    #[test]
    fn reads_oauth_auth_file() {
        let path = temp_auth_file_path("oauth");
        fs::write(
            &path,
            r#"{
  "authMode": "oauth",
  "oauth": {
    "accessToken": "mstl_oat_access",
    "refreshToken": "mstl_ort_refresh",
    "expiresAt": 12345,
    "scope": "organization:read"
  }
}
"#,
        )
        .expect("write auth file");

        let credential = read_auth_credential_from_path(&path).expect("read oauth auth");

        assert_eq!(
            credential,
            AuthCredential::OAuth(crate::auth_file::OAuthAuth {
                access_token: "mstl_oat_access".to_owned(),
                refresh_token: "mstl_ort_refresh".to_owned(),
                expires_at_unix_seconds: 12345,
                scope: "organization:read".to_owned(),
            })
        );
    }

    #[test]
    fn writes_minimal_api_key_auth_file() {
        let path = temp_auth_file_path("write");

        write_api_key_to_path(&path, " mstl_apk_written ").expect("write api key");

        let contents = fs::read_to_string(path).expect("read written auth file");
        assert_eq!(
            contents,
            "{\n  \"authMode\": \"api_key\",\n  \"apiKey\": \"mstl_apk_written\"\n}\n"
        );
    }

    #[cfg(unix)]
    #[test]
    fn tightens_existing_auth_file_permissions_when_rewriting() {
        use std::fs::Permissions;
        use std::os::unix::fs::PermissionsExt;

        let path = temp_auth_file_path("permissions");
        fs::write(&path, "{}\n").expect("write existing auth file");
        fs::set_permissions(&path, Permissions::from_mode(0o644))
            .expect("set existing auth file permissions");

        write_api_key_to_path(&path, "mstl_apk_written").expect("rewrite auth file");

        let permissions = fs::metadata(&path)
            .expect("read auth file metadata")
            .permissions()
            .mode()
            & 0o777;
        assert_eq!(permissions, 0o600);
    }

    fn temp_auth_file_path(name: &str) -> std::path::PathBuf {
        let directory = std::env::temp_dir().join(format!(
            "mistle-auth-file-test-{}-{}",
            std::process::id(),
            name
        ));
        fs::create_dir_all(&directory).expect("create temp auth directory");
        directory.join("auth.json")
    }
}
