use std::collections::BTreeMap;
use std::fs;
use std::io::Write;
use std::os::unix::fs::PermissionsExt;
use std::time::Duration;

use flate2::Compression;
use flate2::write::GzEncoder;
use tar::{Builder, EntryType, Header};

use crate::runtime::plan::{
    RuntimeArtifactGitHubReleaseAssetShape, RuntimeArtifactGitHubReleaseBinaryAssetShape,
    RuntimeArtifactGitHubReleaseInstallAsset,
};
use crate::time::testing::{ManualSleeper, MutableClock};

use super::{
    GitHubReleaseAssetResponse, GitHubReleaseResponse, InstallWorkspace, RetryableFailure,
    StepBudget, apply_managed_github_client_env, build_mise_install_command, compute_file_sha256,
    find_first_matching_published_release, github_release_asset_download_url,
    is_retryable_http_status, materialize_github_release_asset, merge_exec_environment,
    run_with_retry, select_release_asset_shape_for_arch, stream_download_to_path_with_retry,
};

#[test]
fn builds_mise_install_command_with_optional_force_and_timeout() {
    let command = build_mise_install_command(
        &[String::from("node@22.0.0"), String::from("pnpm@10.0.0")],
        Some(true),
        Some(120_000),
    );

    assert_eq!(
        command.args,
        vec![
            "mise".to_string(),
            "install".to_string(),
            "--force".to_string(),
            "node@22.0.0".to_string(),
            "pnpm@10.0.0".to_string(),
        ]
    );
    assert_eq!(command.timeout_ms, Some(120_000));
}

#[test]
fn merges_managed_env_into_artifact_exec_commands() {
    let command_env = BTreeMap::from([("TOOL_HOME".to_string(), "/root/.tool".to_string())]);
    let managed_env = BTreeMap::from([
        (
            "HTTPS_PROXY".to_string(),
            "http://127.0.0.1:4819".to_string(),
        ),
        (
            "SSL_CERT_FILE".to_string(),
            "/run/mistle/proxy-ca-bundle.crt".to_string(),
        ),
    ]);

    let env = merge_exec_environment(Some(&command_env), Some(&managed_env))
        .expect("artifact exec env should merge managed values")
        .expect("merged env should exist");

    assert_eq!(env.get("TOOL_HOME"), Some(&"/root/.tool".to_string()));
    assert_eq!(
        env.get("HTTPS_PROXY"),
        Some(&"http://127.0.0.1:4819".to_string())
    );
    assert_eq!(
        env.get("SSL_CERT_FILE"),
        Some(&"/run/mistle/proxy-ca-bundle.crt".to_string())
    );
}

#[test]
fn rejects_artifact_exec_command_env_that_overrides_managed_values() {
    let command_env =
        BTreeMap::from([("HTTPS_PROXY".to_string(), "http://127.0.0.1:1".to_string())]);
    let managed_env = BTreeMap::from([(
        "HTTPS_PROXY".to_string(),
        "http://127.0.0.1:4819".to_string(),
    )]);

    let error = merge_exec_environment(Some(&command_env), Some(&managed_env))
        .expect_err("artifact exec env should reject managed env conflicts");

    assert_eq!(
        error,
        "artifact install command env defines managed env 'HTTPS_PROXY', which sandboxd reserves"
    );
}

#[test]
fn computes_sha256_as_lowercase_hex() {
    let test_dir = tempfile::tempdir().expect("temp dir should be creatable");
    let file_path = test_dir.path().join("artifact");
    fs::write(&file_path, b"abc").expect("fixture artifact should be writable");

    let sha256 = compute_file_sha256(&file_path).expect("sha256 should compute");

    assert_eq!(
        sha256,
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
}

#[test]
fn github_release_client_rejects_invalid_managed_proxy_url() {
    let managed_env = BTreeMap::from([("HTTPS_PROXY".to_string(), "://bad".to_string())]);

    let error = apply_managed_github_client_env(reqwest::blocking::Client::builder(), &managed_env)
        .expect_err("invalid managed proxy url should fail fast")
        .to_string();

    assert!(
        error.contains("managed HTTPS proxy configuration is invalid"),
        "unexpected error: {error}"
    );
}

#[test]
fn selects_github_release_assets_by_runtime_architecture() {
    let x86_asset = RuntimeArtifactGitHubReleaseAssetShape::Binary(
        RuntimeArtifactGitHubReleaseBinaryAssetShape {
            file_name: "tool-linux-amd64".to_string(),
            format: crate::runtime::plan::RuntimeArtifactGitHubReleaseBinaryAssetFormat::Binary,
            sha256: None,
        },
    );
    let arm_asset = RuntimeArtifactGitHubReleaseAssetShape::Binary(
        RuntimeArtifactGitHubReleaseBinaryAssetShape {
            file_name: "tool-linux-arm64".to_string(),
            format: crate::runtime::plan::RuntimeArtifactGitHubReleaseBinaryAssetFormat::Binary,
            sha256: None,
        },
    );
    let by_arch_asset = RuntimeArtifactGitHubReleaseInstallAsset::ByArch {
        x86_64: x86_asset.clone(),
        aarch64: arm_asset.clone(),
    };

    assert_eq!(
        select_release_asset_shape_for_arch(&by_arch_asset, "x86_64")
            .expect("x86_64 should resolve"),
        &x86_asset
    );
    assert_eq!(
        select_release_asset_shape_for_arch(&by_arch_asset, "arm64")
            .expect("arm64 should resolve to aarch64 asset"),
        &arm_asset
    );
    assert!(
        select_release_asset_shape_for_arch(&by_arch_asset, "riscv64").is_err(),
        "unsupported architectures should fail fast"
    );
}

#[test]
fn finds_first_published_release_matching_prefix_in_page_order() {
    let releases = vec![
        GitHubReleaseResponse {
            tag_name: "slack/v2.0.0-rc1".to_string(),
            draft: false,
            prerelease: true,
            published_at: Some("2026-01-01T00:00:00Z".to_string()),
            assets: vec![],
        },
        GitHubReleaseResponse {
            tag_name: "jira/v1.0.0".to_string(),
            draft: false,
            prerelease: false,
            published_at: Some("2026-01-01T00:00:00Z".to_string()),
            assets: vec![],
        },
        GitHubReleaseResponse {
            tag_name: "slack/v1.2.3".to_string(),
            draft: false,
            prerelease: false,
            published_at: Some("2026-01-02T00:00:00Z".to_string()),
            assets: vec![GitHubReleaseAssetResponse {
                name: "slack-linux-amd64".to_string(),
                browser_download_url: "https://example.invalid/slack".to_string(),
            }],
        },
    ];

    let selected_release = find_first_matching_published_release(&releases, "slack/")
        .expect("published release with matching prefix should be selected");

    assert_eq!(selected_release.tag_name, "slack/v1.2.3");
}

#[test]
fn builds_direct_download_urls_for_exact_tag_assets() {
    let url = github_release_asset_download_url(
        "openai/codex",
        "rust-v0.135.0",
        "codex-x86_64-unknown-linux-musl.tar.gz",
    )
    .expect("exact tag asset url should build");

    assert_eq!(
        url.as_str(),
        "https://github.com/openai/codex/releases/download/rust-v0.135.0/codex-x86_64-unknown-linux-musl.tar.gz"
    );
}

#[test]
fn retries_retryable_failures_with_locked_backoff_schedule() {
    let clock = MutableClock::new(100);
    let sleeper = ManualSleeper::default();
    let budget = StepBudget::new(None, &clock);
    let mut attempts = 0;

    let result = run_with_retry(&budget, &sleeper, |_| {
        attempts += 1;
        if attempts < 3 {
            return Err(RetryableFailure {
                message: format!("transient failure #{attempts}"),
                retryable: true,
            });
        }

        Ok("ok")
    })
    .expect("third retryable attempt should succeed");

    assert_eq!(result, "ok");
    assert_eq!(
        sleeper.requested_durations(),
        vec![Duration::from_secs(1), Duration::from_secs(2)]
    );
}

#[test]
fn stops_retrying_when_next_backoff_exhausts_remaining_budget() {
    let clock = MutableClock::new(1_000);
    let sleeper = ManualSleeper::default();
    let budget = StepBudget::new(Some(1_000), &clock);

    let error = run_with_retry::<(), _, _, _>(&budget, &sleeper, |_| {
        Err(RetryableFailure {
            message: "transient failure".to_string(),
            retryable: true,
        })
    })
    .expect_err("timeout budget should prevent another retry attempt");

    assert_eq!(error, "github release install timed out after 1000ms");
    assert!(
        sleeper.requested_durations().is_empty(),
        "no backoff sleep should happen when the budget is already exhausted"
    );
}

#[test]
fn installs_binary_assets_with_executable_permissions() {
    let test_dir = tempfile::tempdir().expect("temp dir should be creatable");
    let install_path = test_dir.path().join("tool");
    let workspace = InstallWorkspace::new(install_path.to_str().expect("utf-8 path"))
        .expect("install workspace should build");
    fs::write(workspace.download_path(), b"#!/bin/sh\necho ok\n")
        .expect("downloaded binary fixture should be writable");
    let clock = MutableClock::new(0);
    let budget = StepBudget::new(Some(1_000), &clock);
    let binary_asset = RuntimeArtifactGitHubReleaseAssetShape::Binary(
        RuntimeArtifactGitHubReleaseBinaryAssetShape {
            file_name: "tool-linux-amd64".to_string(),
            format: crate::runtime::plan::RuntimeArtifactGitHubReleaseBinaryAssetFormat::Binary,
            sha256: None,
        },
    );

    materialize_github_release_asset(workspace, &binary_asset, &budget)
        .expect("binary asset should install");

    assert_eq!(
        fs::read(&install_path).expect("installed binary should exist"),
        b"#!/bin/sh\necho ok\n"
    );
    let installed_mode = fs::metadata(&install_path)
        .expect("installed binary metadata should exist")
        .permissions()
        .mode()
        & 0o777;
    assert_eq!(installed_mode, 0o755);
}

#[test]
fn installs_tar_gz_assets_with_executable_permissions() {
    let test_dir = tempfile::tempdir().expect("temp dir should be creatable");
    let install_path = test_dir.path().join("gh");
    let workspace = InstallWorkspace::new(install_path.to_str().expect("utf-8 path"))
        .expect("install workspace should build");
    let archive_bytes = create_tar_gz_bytes("gh_2.0.0_linux_amd64/bin/gh", b"#!/bin/sh\necho gh\n");
    fs::write(workspace.download_path(), archive_bytes)
        .expect("downloaded archive fixture should be writable");
    let clock = MutableClock::new(0);
    let budget = StepBudget::new(Some(1_000), &clock);
    let tar_gz_asset = RuntimeArtifactGitHubReleaseAssetShape::TarGz(
        crate::runtime::plan::RuntimeArtifactGitHubReleaseTarGzAssetShape {
            file_name: "gh_2.0.0_linux_amd64.tar.gz".to_string(),
            format: crate::runtime::plan::RuntimeArtifactGitHubReleaseTarGzAssetFormat::TarGz,
            extracted_path: "gh_2.0.0_linux_amd64/bin/gh".to_string(),
            sha256: None,
        },
    );

    materialize_github_release_asset(workspace, &tar_gz_asset, &budget)
        .expect("tar.gz asset should install the requested entry");

    assert_eq!(
        fs::read(&install_path).expect("installed gh binary should exist"),
        b"#!/bin/sh\necho gh\n"
    );
    let installed_mode = fs::metadata(&install_path)
        .expect("installed binary metadata should exist")
        .permissions()
        .mode()
        & 0o777;
    assert_eq!(installed_mode, 0o755);
}

#[test]
fn installs_tar_gz_directory_assets_with_adjacent_files() {
    let test_dir = tempfile::tempdir().expect("temp dir should be creatable");
    let install_path = test_dir.path().join("pi-dist");
    let workspace = InstallWorkspace::new(install_path.to_str().expect("utf-8 path"))
        .expect("install workspace should build");
    let archive_bytes = create_tar_gz_entries(&[
        TarGzEntry::directory("pi", 0o755),
        TarGzEntry::file("pi/package.json", br#"{"name":"pi"}"#, 0o644),
        TarGzEntry::file("pi/pi", b"#!/bin/sh\necho pi\n", 0o755),
        TarGzEntry::directory("pi/theme", 0o755),
        TarGzEntry::file("pi/theme/dark.json", br#"{"theme":"dark"}"#, 0o644),
    ]);
    fs::write(workspace.download_path(), archive_bytes)
        .expect("downloaded archive fixture should be writable");
    let clock = MutableClock::new(0);
    let budget = StepBudget::new(Some(1_000), &clock);
    let tar_gz_asset = RuntimeArtifactGitHubReleaseAssetShape::TarGz(
        crate::runtime::plan::RuntimeArtifactGitHubReleaseTarGzAssetShape {
            file_name: "pi-linux-arm64.tar.gz".to_string(),
            format: crate::runtime::plan::RuntimeArtifactGitHubReleaseTarGzAssetFormat::TarGz,
            extracted_path: "pi".to_string(),
            sha256: None,
        },
    );

    materialize_github_release_asset(workspace, &tar_gz_asset, &budget)
        .expect("tar.gz asset should install the requested directory");

    assert_eq!(
        fs::read(install_path.join("package.json"))
            .expect("installed package metadata should exist"),
        br#"{"name":"pi"}"#
    );
    assert_eq!(
        fs::read(install_path.join("theme/dark.json")).expect("installed theme asset should exist"),
        br#"{"theme":"dark"}"#
    );
    assert_eq!(
        fs::read(install_path.join("pi")).expect("installed pi binary should exist"),
        b"#!/bin/sh\necho pi\n"
    );
    let installed_mode = fs::metadata(install_path.join("pi"))
        .expect("installed pi binary metadata should exist")
        .permissions()
        .mode()
        & 0o777;
    assert_eq!(installed_mode, 0o755);
}

#[test]
fn fails_materialization_when_timeout_budget_is_already_exhausted() {
    let test_dir = tempfile::tempdir().expect("temp dir should be creatable");
    let install_path = test_dir.path().join("tool");
    let workspace = InstallWorkspace::new(install_path.to_str().expect("utf-8 path"))
        .expect("install workspace should build");
    fs::write(workspace.download_path(), b"#!/bin/sh\necho ok\n")
        .expect("downloaded binary fixture should be writable");
    let clock = MutableClock::new(0);
    let budget = StepBudget::new(Some(1_000), &clock);
    clock.advance_ms(1_000);
    let binary_asset = RuntimeArtifactGitHubReleaseAssetShape::Binary(
        RuntimeArtifactGitHubReleaseBinaryAssetShape {
            file_name: "tool-linux-amd64".to_string(),
            format: crate::runtime::plan::RuntimeArtifactGitHubReleaseBinaryAssetFormat::Binary,
            sha256: None,
        },
    );

    let error = materialize_github_release_asset(workspace, &binary_asset, &budget)
        .expect_err("materialization should fail when the timeout budget is exhausted");

    assert_eq!(error, "github release install timed out after 1000ms");
    assert!(
        !install_path.exists(),
        "failed materialization should not install the artifact"
    );
}

#[test]
fn retries_streamed_download_body_failures_and_truncates_partial_files() {
    let test_dir = tempfile::tempdir().expect("temp dir should be creatable");
    let download_path = test_dir.path().join("artifact-download");
    let clock = MutableClock::new(0);
    let sleeper = ManualSleeper::default();
    let budget = StepBudget::new(Some(5_000), &clock);
    let mut attempts = 0;

    stream_download_to_path_with_retry(&download_path, &budget, &sleeper, |_, file| {
        attempts += 1;
        if attempts == 1 {
            file.write_all(b"partial")
                .expect("partial fixture bytes should write");
            return Err(RetryableFailure {
                message: "stream interrupted".to_string(),
                retryable: true,
            });
        }

        file.write_all(b"complete")
            .expect("complete fixture bytes should write");
        Ok(())
    })
    .expect("retry should rewrite the download path with the successful body");

    assert_eq!(
        fs::read(&download_path).expect("download file should exist"),
        b"complete"
    );
    assert_eq!(sleeper.requested_durations(), vec![Duration::from_secs(1)]);
}

#[test]
fn classifies_retryable_github_http_statuses() {
    assert!(is_retryable_http_status(reqwest::StatusCode::FORBIDDEN));
    assert!(is_retryable_http_status(
        reqwest::StatusCode::TOO_MANY_REQUESTS
    ));
    assert!(is_retryable_http_status(reqwest::StatusCode::BAD_GATEWAY));
    assert!(!is_retryable_http_status(reqwest::StatusCode::NOT_FOUND));
}

struct TarGzEntry<'a> {
    path: &'a str,
    contents: &'a [u8],
    mode: u32,
    entry_type: EntryType,
}

impl<'a> TarGzEntry<'a> {
    fn file(path: &'a str, contents: &'a [u8], mode: u32) -> Self {
        Self {
            path,
            contents,
            mode,
            entry_type: EntryType::Regular,
        }
    }

    fn directory(path: &'a str, mode: u32) -> Self {
        Self {
            path,
            contents: &[],
            mode,
            entry_type: EntryType::Directory,
        }
    }
}

fn create_tar_gz_bytes(path: &str, contents: &[u8]) -> Vec<u8> {
    create_tar_gz_entries(&[TarGzEntry::file(path, contents, 0o755)])
}

fn create_tar_gz_entries(entries: &[TarGzEntry<'_>]) -> Vec<u8> {
    let mut tar_bytes = Vec::new();
    {
        let encoder = GzEncoder::new(&mut tar_bytes, Compression::default());
        let mut archive = Builder::new(encoder);
        for entry in entries {
            let mut header = Header::new_gnu();
            header
                .set_path(entry.path)
                .expect("archive path should be valid");
            header.set_mode(entry.mode);
            header.set_entry_type(entry.entry_type);
            header.set_size(
                entry
                    .contents
                    .len()
                    .try_into()
                    .expect("contents should fit in u64"),
            );
            header.set_cksum();
            archive
                .append(&header, entry.contents)
                .expect("archive entry should append");
        }
        let encoder = archive.into_inner().expect("archive should finish");
        encoder.finish().expect("gzip encoder should finish");
    }
    tar_bytes
}
