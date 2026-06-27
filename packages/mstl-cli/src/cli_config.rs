use std::env::{self, VarError};
use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::CliError;

const CONFIG_DIR_NAME: &str = "mistle";
const CONFIG_FILE_NAME: &str = "config.json";

#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CliConfig {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_profile_id: Option<String>,
}

pub(crate) fn read_cli_config() -> Result<CliConfig, CliError> {
    let config_path = default_cli_config_file_path()?;
    read_cli_config_from_path(&config_path)
}

pub(crate) fn read_default_profile_id() -> Result<Option<String>, CliError> {
    read_cli_config().map(|config| config.default_profile_id)
}

pub(crate) fn write_default_profile_id(profile_id: &str) -> Result<PathBuf, CliError> {
    let config_path = default_cli_config_file_path()?;
    let mut config = read_cli_config_from_path(&config_path)?;
    config.default_profile_id = Some(profile_id.trim().to_owned());
    write_cli_config_to_path(&config_path, &config)?;
    Ok(config_path)
}

pub(crate) fn unset_default_profile_id() -> Result<PathBuf, CliError> {
    let config_path = default_cli_config_file_path()?;
    let mut config = read_cli_config_from_path(&config_path)?;
    config.default_profile_id = None;
    write_cli_config_to_path(&config_path, &config)?;
    Ok(config_path)
}

fn read_cli_config_from_path(path: &Path) -> Result<CliConfig, CliError> {
    let contents = match fs::read_to_string(path) {
        Ok(contents) => contents,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(CliConfig::default()),
        Err(source) => {
            return Err(CliError::ReadConfigFile {
                path: path.display().to_string(),
                source,
            });
        }
    };

    let config = serde_json::from_str::<CliConfig>(&contents).map_err(|source| {
        CliError::ParseConfigFile {
            path: path.display().to_string(),
            source,
        }
    })?;

    if let Some(profile_id) = &config.default_profile_id
        && profile_id.trim().is_empty()
    {
        return Err(CliError::InvalidConfigFile {
            path: path.display().to_string(),
            message: "defaultProfileId cannot be blank",
        });
    }

    Ok(CliConfig {
        default_profile_id: config
            .default_profile_id
            .map(|profile_id| profile_id.trim().to_owned()),
    })
}

fn write_cli_config_to_path(path: &Path, config: &CliConfig) -> Result<(), CliError> {
    let parent = path.parent().ok_or_else(|| CliError::InvalidConfigFile {
        path: path.display().to_string(),
        message: "config file path must have a parent directory",
    })?;
    fs::create_dir_all(parent).map_err(|source| CliError::CreateConfigDirectory {
        path: parent.display().to_string(),
        source,
    })?;

    let serialized = serde_json::to_string_pretty(config)
        .map_err(|source| CliError::SerializeConfigFile { source })?;

    let mut options = OpenOptions::new();
    options.create(true).truncate(true).write(true);

    let mut file = options
        .open(path)
        .map_err(|source| CliError::WriteConfigFile {
            path: path.display().to_string(),
            source,
        })?;
    file.write_all(serialized.as_bytes())
        .and_then(|()| file.write_all(b"\n"))
        .map_err(|source| CliError::WriteConfigFile {
            path: path.display().to_string(),
            source,
        })
}

fn default_cli_config_file_path() -> Result<PathBuf, CliError> {
    Ok(default_config_home()?
        .join(CONFIG_DIR_NAME)
        .join(CONFIG_FILE_NAME))
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

    use crate::cli_config::{CliConfig, read_cli_config_from_path, write_cli_config_to_path};

    #[test]
    fn missing_config_file_reads_as_empty_config() {
        let path = temp_config_file_path("missing");

        let config = read_cli_config_from_path(&path).expect("missing config should read");

        assert_eq!(config, CliConfig::default());
    }

    #[test]
    fn reads_trimmed_default_profile_id() {
        let path = temp_config_file_path("read-default-profile");
        fs::create_dir_all(path.parent().expect("config path should have parent"))
            .expect("create config parent");
        fs::write(
            &path,
            r#"{
  "defaultProfileId": " sbp_python "
}
"#,
        )
        .expect("write config");

        let config = read_cli_config_from_path(&path).expect("config should read");

        assert_eq!(
            config,
            CliConfig {
                default_profile_id: Some("sbp_python".to_owned()),
            }
        );
    }

    #[test]
    fn rejects_blank_default_profile_id() {
        let path = temp_config_file_path("blank-default-profile");
        fs::create_dir_all(path.parent().expect("config path should have parent"))
            .expect("create config parent");
        fs::write(
            &path,
            r#"{
  "defaultProfileId": " "
}
"#,
        )
        .expect("write config");

        let error =
            read_cli_config_from_path(&path).expect_err("blank default profile should fail");

        assert_eq!(
            error.to_string(),
            format!(
                "invalid config file `{}`: defaultProfileId cannot be blank",
                path.display()
            )
        );
    }

    #[test]
    fn writes_human_editable_config_file() {
        let path = temp_config_file_path("write");
        write_cli_config_to_path(
            &path,
            &CliConfig {
                default_profile_id: Some("sbp_python".to_owned()),
            },
        )
        .expect("config should write");

        let contents = fs::read_to_string(&path).expect("config should be readable");

        assert_eq!(contents, "{\n  \"defaultProfileId\": \"sbp_python\"\n}\n");
    }

    fn temp_config_file_path(test_name: &str) -> std::path::PathBuf {
        std::env::temp_dir()
            .join(format!(
                "mistle-cli-config-{test_name}-{}",
                std::process::id()
            ))
            .join("config.json")
    }
}
