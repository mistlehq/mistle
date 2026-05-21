use std::fs;
use std::path::{Path, PathBuf};

use tempfile::TempDir;

use crate::runtime::artifact_install::install_parent_directory;

pub(super) struct InstallWorkspace {
    temp_dir: TempDir,
    download_path: PathBuf,
    staged_path: PathBuf,
    install_path: PathBuf,
}

impl InstallWorkspace {
    pub(super) fn new(install_path: &str) -> Result<Self, String> {
        let install_path = PathBuf::from(install_path);
        let install_parent = install_parent_directory(&install_path);
        let temp_dir = TempDir::new_in(install_parent)
            .map_err(|error| format!("failed to create staged install directory: {error}"))?;

        Ok(Self {
            download_path: temp_dir.path().join("downloaded-asset"),
            staged_path: temp_dir.path().join("staged-asset"),
            install_path,
            temp_dir,
        })
    }

    pub(super) fn download_path(&self) -> &Path {
        &self.download_path
    }

    pub(super) fn staged_path(&self) -> &Path {
        &self.staged_path
    }

    pub(super) fn finalize_download(self) -> Result<(), String> {
        let source_path = self.download_path.clone();
        self.finalize_path(source_path)
    }

    pub(super) fn finalize_staged(self) -> Result<(), String> {
        let source_path = self.staged_path.clone();
        self.finalize_path(source_path)
    }

    pub(super) fn finalize_path(self, source_path: PathBuf) -> Result<(), String> {
        fs::rename(&source_path, &self.install_path)
            .map_err(|error| format!("failed to move staged install into place: {error}"))?;
        self.temp_dir
            .close()
            .map_err(|error| format!("failed to clean up staged install directory: {error}"))
    }
}
