use std::collections::BTreeMap;
use std::fs::{self, File};
use std::io::Read;
use std::os::unix::fs::PermissionsExt;
use std::path::{Component, Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use flate2::read::GzDecoder;
use reqwest::blocking::{Client, ClientBuilder, Response};
use reqwest::header::ACCEPT;
use reqwest::{Certificate, Proxy, StatusCode, Url};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use tar::Archive;
use tempfile::TempDir;

use crate::command::{
    CommandOutputSink, CommandSpec, DEFAULT_COMMAND_POLL_INTERVAL,
    run_command_with_details_and_output_sink,
};
use crate::time::{Clock, Sleeper, SystemClock, ThreadSleeper};

use super::plan::{
    RuntimeArtifactGitHubReleaseAssetShape, RuntimeArtifactGitHubReleaseInstallAsset,
    RuntimeArtifactGitHubReleaseSelector, RuntimeArtifactGitHubReleaseTagSelector,
};
use super::{RuntimeArtifactInstallStep, RuntimeExecCommand};

const GITHUB_API_BASE_URL: &str = "https://api.github.com";
const GITHUB_RELEASES_BASE_URL: &str = "https://github.com";
const GITHUB_API_ACCEPT_HEADER: &str = "application/vnd.github+json";
const GITHUB_INSTALLER_USER_AGENT: &str = "mistle-sandboxd-artifact-installer";
const GITHUB_RELEASE_ATTEMPTS: usize = 3;
const GITHUB_RELEASE_RETRY_BACKOFFS_MS: [u64; 2] = [1_000, 2_000];
const INSTALLED_BINARY_MODE: u32 = 0o755;

pub(crate) fn artifact_install_step_op(step: &RuntimeArtifactInstallStep) -> &'static str {
    match step {
        RuntimeArtifactInstallStep::GitHubReleaseInstall { .. } => "github_release_install",
        RuntimeArtifactInstallStep::MiseInstall { .. } => "mise_install",
        RuntimeArtifactInstallStep::Exec { .. } => "exec",
    }
}

pub(crate) fn apply_artifact_install_step(
    step: &RuntimeArtifactInstallStep,
    managed_env: Option<&BTreeMap<String, String>>,
    output_sink: Option<Arc<dyn CommandOutputSink>>,
) -> Result<(), String> {
    apply_artifact_install_step_with_dependencies(
        step,
        managed_env,
        output_sink,
        &SystemClock,
        &ThreadSleeper,
    )
}

fn apply_artifact_install_step_with_dependencies<C, S>(
    step: &RuntimeArtifactInstallStep,
    managed_env: Option<&BTreeMap<String, String>>,
    output_sink: Option<Arc<dyn CommandOutputSink>>,
    clock: &C,
    sleeper: &S,
) -> Result<(), String>
where
    C: Clock,
    S: Sleeper,
{
    match step {
        RuntimeArtifactInstallStep::Exec { command } => {
            apply_exec_command(command, managed_env, output_sink, clock, sleeper)
        }
        RuntimeArtifactInstallStep::MiseInstall {
            tools,
            force,
            timeout_ms,
        } => {
            let command = build_mise_install_command(tools, *force, *timeout_ms);
            apply_exec_command(&command, managed_env, output_sink, clock, sleeper)
        }
        RuntimeArtifactInstallStep::GitHubReleaseInstall {
            repository,
            release,
            asset,
            install_path,
            timeout_ms,
        } => apply_github_release_install(
            GitHubReleaseInstallRequest {
                repository,
                release,
                asset,
                install_path,
                timeout_ms: *timeout_ms,
                managed_env,
            },
            clock,
            sleeper,
        ),
    }
}

fn apply_exec_command<C, S>(
    command: &RuntimeExecCommand,
    managed_env: Option<&BTreeMap<String, String>>,
    output_sink: Option<Arc<dyn CommandOutputSink>>,
    clock: &C,
    sleeper: &S,
) -> Result<(), String>
where
    C: Clock,
    S: Sleeper,
{
    let env = merge_exec_environment(command.env.as_ref(), managed_env)?;
    run_command_with_details_and_output_sink(
        CommandSpec {
            args: &command.args,
            env: env.as_ref(),
            cwd: command.cwd.as_deref(),
            timeout_ms: command.timeout_ms,
        },
        clock,
        sleeper,
        DEFAULT_COMMAND_POLL_INTERVAL,
        output_sink,
    )
    .map_err(|error| error.message)
}

fn merge_exec_environment(
    command_env: Option<&BTreeMap<String, String>>,
    managed_env: Option<&BTreeMap<String, String>>,
) -> Result<Option<BTreeMap<String, String>>, String> {
    let Some(managed_env) = managed_env else {
        return Ok(command_env.cloned());
    };
    let mut merged = command_env.cloned().unwrap_or_default();
    for (name, value) in managed_env {
        match merged.get(name) {
            Some(existing_value) if existing_value != value => {
                return Err(format!(
                    "artifact install command env defines managed env '{name}', which sandboxd reserves"
                ));
            }
            Some(_) => {}
            None => {
                merged.insert(name.clone(), value.clone());
            }
        }
    }
    Ok(Some(merged))
}

fn build_mise_install_command(
    tools: &[String],
    force: Option<bool>,
    timeout_ms: Option<u64>,
) -> RuntimeExecCommand {
    let mut args = vec!["mise".to_string(), "install".to_string()];
    if force == Some(true) {
        args.push("--force".to_string());
    }
    args.extend(tools.iter().cloned());

    RuntimeExecCommand {
        args,
        env: None,
        cwd: None,
        timeout_ms,
    }
}

struct GitHubReleaseInstallRequest<'a> {
    repository: &'a str,
    release: &'a RuntimeArtifactGitHubReleaseSelector,
    asset: &'a RuntimeArtifactGitHubReleaseInstallAsset,
    install_path: &'a str,
    timeout_ms: Option<u64>,
    managed_env: Option<&'a BTreeMap<String, String>>,
}

fn apply_github_release_install<C, S>(
    input: GitHubReleaseInstallRequest<'_>,
    clock: &C,
    sleeper: &S,
) -> Result<(), String>
where
    C: Clock,
    S: Sleeper,
{
    let GitHubReleaseInstallRequest {
        repository,
        release,
        asset,
        install_path,
        timeout_ms,
        managed_env,
    } = input;
    let client = build_github_client(managed_env)?;
    let budget = StepBudget::new(timeout_ms, clock);
    let selector_description = describe_release_selector(release);
    let workspace = InstallWorkspace::new(install_path)?;
    let asset_shape = select_release_asset_shape(asset)?;
    let asset_name = github_release_asset_shape_file_name(asset_shape);
    let download_url = resolve_github_release_asset_download_url(
        &client,
        repository,
        release,
        &selector_description,
        asset_name,
        &budget,
        sleeper,
    )?;

    let download_failure_context = format!(
        "github release asset download failed for {repository} release {selector_description} asset {asset_name}"
    );
    download_github_asset_to_path(
        &client,
        &download_url,
        workspace.download_path(),
        &download_failure_context,
        &budget,
        sleeper,
    )?;
    budget.remaining_timeout_duration()?;
    verify_github_release_asset_sha256(
        workspace.download_path(),
        github_release_asset_shape_sha256(asset_shape),
        &download_failure_context,
    )?;
    budget.remaining_timeout_duration()?;

    materialize_github_release_asset(workspace, asset_shape, &budget).map_err(|error| {
        format!(
            "github release asset install failed for {repository} release {selector_description} asset {asset_name} installPath={install_path}: {error}"
        )
    })
}

fn resolve_github_release_asset_download_url<C, S>(
    client: &Client,
    repository: &str,
    release: &RuntimeArtifactGitHubReleaseSelector,
    selector_description: &str,
    asset_name: &str,
    budget: &StepBudget<'_, C>,
    sleeper: &S,
) -> Result<String, String>
where
    C: Clock,
    S: Sleeper,
{
    match release {
        RuntimeArtifactGitHubReleaseSelector::Tag {
            selector: RuntimeArtifactGitHubReleaseTagSelector::Exact { tag },
        } => github_release_asset_download_url(repository, tag, asset_name)
            .map(|url| url.to_string()),
        _ => {
            let resolved_release = resolve_github_release(
                client,
                repository,
                release,
                selector_description,
                budget,
                sleeper,
            )?;
            resolved_release
                .assets
                .iter()
                .find(|release_asset| release_asset.name == asset_name)
                .map(|release_asset| release_asset.browser_download_url.clone())
                .ok_or_else(|| {
                    format!(
                        "github release asset lookup failed for {repository} release {selector_description} resolved tag {}: asset {asset_name} not found",
                        resolved_release.tag_name
                    )
                })
        }
    }
}

fn build_github_client(managed_env: Option<&BTreeMap<String, String>>) -> Result<Client, String> {
    let mut builder = Client::builder().user_agent(GITHUB_INSTALLER_USER_AGENT);
    if let Some(managed_env) = managed_env {
        builder = apply_managed_github_client_env(builder, managed_env)?;
    } else {
        builder = builder.no_proxy();
    }
    builder
        .build()
        .map_err(|error| format!("failed to build github release installer client: {error}"))
}

fn apply_managed_github_client_env(
    mut builder: ClientBuilder,
    managed_env: &BTreeMap<String, String>,
) -> Result<ClientBuilder, String> {
    if let Some(proxy_url) = managed_env
        .get("HTTPS_PROXY")
        .or_else(|| managed_env.get("https_proxy"))
        .or_else(|| managed_env.get("ALL_PROXY"))
        .or_else(|| managed_env.get("all_proxy"))
    {
        let proxy = Proxy::all(proxy_url).map_err(|error| {
            format!(
                "managed HTTPS proxy configuration is invalid for github release install: {error}"
            )
        })?;
        builder = builder.proxy(proxy);
    } else {
        builder = builder.no_proxy();
    }

    if let Some(certificate_path) = managed_env
        .get("SSL_CERT_FILE")
        .or_else(|| managed_env.get("CURL_CA_BUNDLE"))
    {
        let certificate_pem = fs::read(certificate_path).map_err(|error| {
            format!(
                "failed to read managed certificate bundle for github release install '{certificate_path}': {error}"
            )
        })?;
        let certificates = Certificate::from_pem_bundle(&certificate_pem).map_err(|error| {
            format!(
                "managed certificate bundle for github release install '{certificate_path}' is invalid: {error}"
            )
        })?;
        for certificate in certificates {
            builder = builder.add_root_certificate(certificate);
        }
    }

    Ok(builder)
}

fn resolve_github_release<C, S>(
    client: &Client,
    repository: &str,
    release: &RuntimeArtifactGitHubReleaseSelector,
    selector_description: &str,
    budget: &StepBudget<'_, C>,
    sleeper: &S,
) -> Result<GitHubReleaseResponse, String>
where
    C: Clock,
    S: Sleeper,
{
    match release {
        RuntimeArtifactGitHubReleaseSelector::Latest => {
            let url = github_api_url(repository, &["releases", "latest"], &[])?;
            request_github_json::<GitHubReleaseResponse, _, _>(
                client,
                &url,
                format!(
                    "github release lookup failed for {repository} release {selector_description}"
                ),
                budget,
                sleeper,
            )
        }
        RuntimeArtifactGitHubReleaseSelector::Tag { selector } => match selector {
            RuntimeArtifactGitHubReleaseTagSelector::Exact { tag } => {
                let url = github_api_url(repository, &["releases", "tags", tag], &[])?;
                request_github_json::<GitHubReleaseResponse, _, _>(
                    client,
                    &url,
                    format!(
                        "github release lookup failed for {repository} release {selector_description}"
                    ),
                    budget,
                    sleeper,
                )
            }
            RuntimeArtifactGitHubReleaseTagSelector::LatestMatchingPrefix { prefix } => {
                resolve_latest_matching_release_prefix(
                    client,
                    repository,
                    prefix,
                    selector_description,
                    budget,
                    sleeper,
                )
            }
        },
    }
}

fn resolve_latest_matching_release_prefix<C, S>(
    client: &Client,
    repository: &str,
    prefix: &str,
    selector_description: &str,
    budget: &StepBudget<'_, C>,
    sleeper: &S,
) -> Result<GitHubReleaseResponse, String>
where
    C: Clock,
    S: Sleeper,
{
    let mut page = 1_u64;
    loop {
        let page_query = [("per_page", "100".to_string()), ("page", page.to_string())];
        let url = github_api_url(repository, &["releases"], &page_query)?;
        let releases = request_github_json::<Vec<GitHubReleaseResponse>, _, _>(
            client,
            &url,
            format!(
                "github release lookup failed for {repository} release {selector_description} page={page}"
            ),
            budget,
            sleeper,
        )?;
        if releases.is_empty() {
            return Err(format!(
                "github release lookup failed for {repository} release {selector_description}: no published release matched"
            ));
        }

        if let Some(release) = find_first_matching_published_release(&releases, prefix) {
            return Ok(release.clone());
        }

        page = page.saturating_add(1);
    }
}

fn request_github_json<T, C, S>(
    client: &Client,
    url: &Url,
    failure_context: String,
    budget: &StepBudget<'_, C>,
    sleeper: &S,
) -> Result<T, String>
where
    T: for<'de> Deserialize<'de>,
    C: Clock,
    S: Sleeper,
{
    let response = send_github_request_with_retry(
        client,
        RequestKind::Api,
        url,
        failure_context,
        budget,
        sleeper,
    )?;

    response
        .json::<T>()
        .map_err(|error| format!("github api returned invalid json: {error}"))
}

fn download_github_asset_to_path<C, S>(
    client: &Client,
    download_url: &str,
    download_path: &Path,
    failure_context: &str,
    budget: &StepBudget<'_, C>,
    sleeper: &S,
) -> Result<(), String>
where
    C: Clock,
    S: Sleeper,
{
    let parsed_download_url = Url::parse(download_url)
        .map_err(|error| format!("github release asset download url is invalid: {error}"))?;

    stream_download_to_path_with_retry(download_path, budget, sleeper, |remaining_timeout, file| {
        let mut request = client.get(parsed_download_url.clone());
        if let Some(timeout) = remaining_timeout {
            request = request.timeout(timeout);
        }

        let mut response = request.send().map_err(|error| RetryableFailure {
            message: format!("{failure_context}: {error}"),
            retryable: true,
        })?;

        if !response.status().is_success() {
            let status = response.status();
            return Err(RetryableFailure {
                message: format!("{failure_context}: http {}", status.as_u16()),
                retryable: is_retryable_http_status(status),
            });
        }

        response.copy_to(file).map_err(|error| RetryableFailure {
            message: format!("{failure_context}: {error}"),
            retryable: true,
        })?;
        Ok(())
    })
}

fn send_github_request_with_retry<C, S>(
    client: &Client,
    request_kind: RequestKind,
    url: &Url,
    failure_context: String,
    budget: &StepBudget<'_, C>,
    sleeper: &S,
) -> Result<Response, String>
where
    C: Clock,
    S: Sleeper,
{
    run_with_retry(budget, sleeper, |remaining_timeout| {
        let mut request = client.get(url.clone());
        if matches!(request_kind, RequestKind::Api) {
            request = request.header(ACCEPT, GITHUB_API_ACCEPT_HEADER);
        }
        if let Some(timeout) = remaining_timeout {
            request = request.timeout(timeout);
        }

        let response = request.send().map_err(|error| RetryableFailure {
            message: format!("{failure_context}: {error}"),
            retryable: true,
        })?;

        if response.status().is_success() {
            return Ok(response);
        }

        let status = response.status();
        Err(RetryableFailure {
            message: format!("{failure_context}: http {}", status.as_u16()),
            retryable: is_retryable_http_status(status),
        })
    })
}

fn materialize_github_release_asset<C>(
    workspace: InstallWorkspace,
    asset_shape: &RuntimeArtifactGitHubReleaseAssetShape,
    budget: &StepBudget<'_, C>,
) -> Result<(), String>
where
    C: Clock,
{
    match asset_shape {
        RuntimeArtifactGitHubReleaseAssetShape::Binary(_) => {
            budget.remaining_timeout_duration()?;
            set_executable_permissions(workspace.download_path())?;
            workspace.finalize_download()
        }
        RuntimeArtifactGitHubReleaseAssetShape::TarGz(shape) => {
            budget.remaining_timeout_duration()?;
            install_tar_gz_entry(
                workspace.download_path(),
                &shape.extracted_path,
                workspace.staged_path(),
            )?;
            budget.remaining_timeout_duration()?;
            set_executable_permissions_if_file(workspace.staged_path())?;
            workspace.finalize_staged()
        }
    }
}

fn verify_github_release_asset_sha256(
    download_path: &Path,
    expected_sha256: Option<&str>,
    failure_context: &str,
) -> Result<(), String> {
    let Some(expected_sha256) = expected_sha256 else {
        return Ok(());
    };
    let actual_sha256 = compute_file_sha256(download_path)?;
    if actual_sha256 != expected_sha256 {
        return Err(format!(
            "{failure_context}: sha256 mismatch expected {expected_sha256} got {actual_sha256}"
        ));
    }
    Ok(())
}

fn compute_file_sha256(path: &Path) -> Result<String, String> {
    let mut file = File::open(path).map_err(|error| {
        format!("failed to open downloaded github release asset for sha256: {error}")
    })?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = file.read(&mut buffer).map_err(|error| {
            format!("failed to read downloaded github release asset for sha256: {error}")
        })?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

fn install_tar_gz_entry(
    archive_path: &Path,
    extracted_path: &str,
    staged_path: &Path,
) -> Result<(), String> {
    let target_path = Path::new(extracted_path);
    let archive_file = File::open(archive_path)
        .map_err(|error| format!("failed to open downloaded github release archive: {error}"))?;
    let mut archive = Archive::new(GzDecoder::new(archive_file));
    let mut found_entry = false;

    for entry_result in archive.entries().map_err(|error| {
        format!("failed to read github release tar.gz entries for {extracted_path}: {error}")
    })? {
        let mut entry = entry_result
            .map_err(|error| format!("failed to read github release tar.gz entry: {error}"))?;
        let entry_path = entry
            .path()
            .map_err(|error| {
                format!("failed to resolve github release tar.gz entry path: {error}")
            })?
            .into_owned();
        let relative_entry_path = if entry_path == target_path {
            PathBuf::new()
        } else {
            match entry_path.strip_prefix(target_path) {
                Ok(relative_path) if !relative_path.as_os_str().is_empty() => {
                    relative_path.to_path_buf()
                }
                _ => continue,
            }
        };
        validate_archive_relative_path(&relative_entry_path, &entry_path)?;

        let destination_path = if relative_entry_path.as_os_str().is_empty() {
            staged_path.to_path_buf()
        } else {
            staged_path.join(&relative_entry_path)
        };
        let entry_type = entry.header().entry_type();
        if entry_type.is_dir() {
            fs::create_dir_all(&destination_path).map_err(|error| {
                format!("failed to create staged install directory from tar.gz: {error}")
            })?;
            found_entry = true;
            continue;
        }
        if !entry_type.is_file() {
            return Err(format!(
                "github release tar.gz entry {} is not a regular file or directory",
                entry_path.display()
            ));
        }

        if let Some(parent_path) = destination_path.parent() {
            fs::create_dir_all(parent_path).map_err(|error| {
                format!("failed to create staged install parent directory from tar.gz: {error}")
            })?;
        }
        entry
            .unpack(&destination_path)
            .map_err(|error| format!("failed to extract github release tar.gz entry: {error}"))?;
        found_entry = true;
        if entry_path == target_path {
            break;
        }
    }

    if !found_entry {
        return Err(format!(
            "github release tar.gz did not contain extractedPath={extracted_path}"
        ));
    }
    Ok(())
}

fn validate_archive_relative_path(relative_path: &Path, entry_path: &Path) -> Result<(), String> {
    for component in relative_path.components() {
        match component {
            Component::Normal(_) | Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err(format!(
                    "github release tar.gz entry {} escapes extractedPath",
                    entry_path.display()
                ));
            }
        }
    }
    Ok(())
}

fn install_parent_directory(install_path: &Path) -> &Path {
    install_path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."))
}

fn set_executable_permissions_if_file(path: &Path) -> Result<(), String> {
    let metadata = fs::metadata(path)
        .map_err(|error| format!("failed to read installed artifact metadata: {error}"))?;
    if metadata.is_file() {
        set_executable_permissions(path)?;
    }
    Ok(())
}

fn set_executable_permissions(path: &Path) -> Result<(), String> {
    fs::set_permissions(path, fs::Permissions::from_mode(INSTALLED_BINARY_MODE))
        .map_err(|error| format!("failed to mark installed artifact executable: {error}"))
}

fn select_release_asset_shape(
    asset: &RuntimeArtifactGitHubReleaseInstallAsset,
) -> Result<&RuntimeArtifactGitHubReleaseAssetShape, String> {
    select_release_asset_shape_for_arch(asset, std::env::consts::ARCH)
}

fn select_release_asset_shape_for_arch<'a>(
    asset: &'a RuntimeArtifactGitHubReleaseInstallAsset,
    arch: &str,
) -> Result<&'a RuntimeArtifactGitHubReleaseAssetShape, String> {
    match asset {
        RuntimeArtifactGitHubReleaseInstallAsset::Exact(shape) => Ok(shape),
        RuntimeArtifactGitHubReleaseInstallAsset::ByArch { x86_64, aarch64 } => match arch {
            "x86_64" => Ok(x86_64),
            "aarch64" | "arm64" => Ok(aarch64),
            other => Err(format!(
                "github release install does not support runtime architecture {other}"
            )),
        },
    }
}

fn github_release_asset_shape_file_name(
    asset_shape: &RuntimeArtifactGitHubReleaseAssetShape,
) -> &str {
    match asset_shape {
        RuntimeArtifactGitHubReleaseAssetShape::Binary(shape) => &shape.file_name,
        RuntimeArtifactGitHubReleaseAssetShape::TarGz(shape) => &shape.file_name,
    }
}

fn github_release_asset_shape_sha256(
    asset_shape: &RuntimeArtifactGitHubReleaseAssetShape,
) -> Option<&str> {
    match asset_shape {
        RuntimeArtifactGitHubReleaseAssetShape::Binary(shape) => shape.sha256.as_deref(),
        RuntimeArtifactGitHubReleaseAssetShape::TarGz(shape) => shape.sha256.as_deref(),
    }
}

fn github_api_url(
    repository: &str,
    segments: &[&str],
    query_pairs: &[(&str, String)],
) -> Result<Url, String> {
    let mut url = Url::parse(GITHUB_API_BASE_URL)
        .expect("github api base url should always parse successfully");
    {
        let mut path_segments = url
            .path_segments_mut()
            .map_err(|_| "github api base url does not support path mutation".to_string())?;
        path_segments.push("repos");
        for repository_segment in repository.split('/') {
            if repository_segment.is_empty() {
                return Err(format!("github repository path is invalid: {repository}"));
            }
            path_segments.push(repository_segment);
        }
        for segment in segments {
            path_segments.push(segment);
        }
    }

    if !query_pairs.is_empty() {
        let mut query = url.query_pairs_mut();
        for (key, value) in query_pairs {
            query.append_pair(key, value);
        }
    }

    Ok(url)
}

fn github_release_asset_download_url(
    repository: &str,
    tag: &str,
    asset_name: &str,
) -> Result<Url, String> {
    let mut url = Url::parse(GITHUB_RELEASES_BASE_URL)
        .expect("github releases base url should always parse successfully");
    {
        let mut path_segments = url
            .path_segments_mut()
            .map_err(|_| "github releases base url does not support path mutation".to_string())?;
        for repository_segment in repository.split('/') {
            if repository_segment.is_empty() {
                return Err(format!("github repository path is invalid: {repository}"));
            }
            path_segments.push(repository_segment);
        }
        path_segments.push("releases");
        path_segments.push("download");
        path_segments.push(tag);
        path_segments.push(asset_name);
    }

    Ok(url)
}

fn describe_release_selector(selector: &RuntimeArtifactGitHubReleaseSelector) -> String {
    match selector {
        RuntimeArtifactGitHubReleaseSelector::Latest => "kind=latest".to_string(),
        RuntimeArtifactGitHubReleaseSelector::Tag { selector } => match selector {
            RuntimeArtifactGitHubReleaseTagSelector::Exact { tag } => {
                format!("tag match=exact tag={tag}")
            }
            RuntimeArtifactGitHubReleaseTagSelector::LatestMatchingPrefix { prefix } => {
                format!("tag match=latest_matching_prefix prefix={prefix}")
            }
        },
    }
}

fn find_first_matching_published_release<'a>(
    releases: &'a [GitHubReleaseResponse],
    prefix: &str,
) -> Option<&'a GitHubReleaseResponse> {
    releases.iter().find(|release| {
        release.published_at.is_some()
            && !release.draft
            && !release.prerelease
            && release.tag_name.starts_with(prefix)
    })
}

fn is_retryable_http_status(status: StatusCode) -> bool {
    status == StatusCode::FORBIDDEN
        || status == StatusCode::TOO_MANY_REQUESTS
        || status.is_server_error()
}

fn run_with_retry<T, C, S, F>(
    budget: &StepBudget<'_, C>,
    sleeper: &S,
    mut operation: F,
) -> Result<T, String>
where
    C: Clock,
    S: Sleeper,
    F: FnMut(Option<Duration>) -> Result<T, RetryableFailure>,
{
    for attempt_index in 0..GITHUB_RELEASE_ATTEMPTS {
        let remaining_timeout = budget.remaining_timeout_duration()?;
        match operation(remaining_timeout) {
            Ok(value) => return Ok(value),
            Err(error) => {
                let attempts_remaining = GITHUB_RELEASE_ATTEMPTS - attempt_index - 1;
                if !error.retryable || attempts_remaining == 0 {
                    return Err(error.message);
                }

                let backoff_ms = GITHUB_RELEASE_RETRY_BACKOFFS_MS
                    .get(attempt_index)
                    .copied()
                    .unwrap_or_default();
                budget.ensure_can_wait(backoff_ms)?;
                sleeper.sleep(Duration::from_millis(backoff_ms));
            }
        }
    }

    Err("github release retry loop exhausted unexpectedly".to_string())
}

fn stream_download_to_path_with_retry<C, S, F>(
    download_path: &Path,
    budget: &StepBudget<'_, C>,
    sleeper: &S,
    mut operation: F,
) -> Result<(), String>
where
    C: Clock,
    S: Sleeper,
    F: FnMut(Option<Duration>, &mut File) -> Result<(), RetryableFailure>,
{
    run_with_retry(budget, sleeper, |remaining_timeout| {
        let mut download_file = File::create(download_path).map_err(|error| RetryableFailure {
            message: format!("failed to create download staging file: {error}"),
            retryable: false,
        })?;
        operation(remaining_timeout, &mut download_file)
    })
}

struct StepBudget<'a, C> {
    timeout_ms: Option<u64>,
    started_at_ms: u64,
    clock: &'a C,
}

impl<'a, C> StepBudget<'a, C>
where
    C: Clock,
{
    fn new(timeout_ms: Option<u64>, clock: &'a C) -> Self {
        Self {
            timeout_ms,
            started_at_ms: clock.now_ms(),
            clock,
        }
    }

    fn remaining_timeout_duration(&self) -> Result<Option<Duration>, String> {
        let Some(timeout_ms) = self.timeout_ms else {
            return Ok(None);
        };
        let elapsed_ms = self.clock.now_ms().saturating_sub(self.started_at_ms);
        let remaining_ms = timeout_ms.saturating_sub(elapsed_ms);
        if remaining_ms == 0 {
            return Err(format!(
                "github release install timed out after {timeout_ms}ms"
            ));
        }

        Ok(Some(Duration::from_millis(remaining_ms)))
    }

    fn ensure_can_wait(&self, duration_ms: u64) -> Result<(), String> {
        let Some(timeout_ms) = self.timeout_ms else {
            return Ok(());
        };
        let elapsed_ms = self.clock.now_ms().saturating_sub(self.started_at_ms);
        let remaining_ms = timeout_ms.saturating_sub(elapsed_ms);
        if remaining_ms <= duration_ms {
            return Err(format!(
                "github release install timed out after {timeout_ms}ms"
            ));
        }
        Ok(())
    }
}

struct RetryableFailure {
    message: String,
    retryable: bool,
}

struct InstallWorkspace {
    temp_dir: TempDir,
    download_path: PathBuf,
    staged_path: PathBuf,
    install_path: PathBuf,
}

impl InstallWorkspace {
    fn new(install_path: &str) -> Result<Self, String> {
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

    fn download_path(&self) -> &Path {
        &self.download_path
    }

    fn staged_path(&self) -> &Path {
        &self.staged_path
    }

    fn finalize_download(self) -> Result<(), String> {
        let source_path = self.download_path.clone();
        self.finalize_path(source_path)
    }

    fn finalize_staged(self) -> Result<(), String> {
        let source_path = self.staged_path.clone();
        self.finalize_path(source_path)
    }

    fn finalize_path(self, source_path: PathBuf) -> Result<(), String> {
        fs::rename(&source_path, &self.install_path)
            .map_err(|error| format!("failed to move staged install into place: {error}"))?;
        self.temp_dir
            .close()
            .map_err(|error| format!("failed to clean up staged install directory: {error}"))
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
struct GitHubReleaseResponse {
    tag_name: String,
    draft: bool,
    prerelease: bool,
    published_at: Option<String>,
    assets: Vec<GitHubReleaseAssetResponse>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
struct GitHubReleaseAssetResponse {
    name: String,
    browser_download_url: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RequestKind {
    Api,
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;
    use std::fs;
    use std::io::Write;
    use std::os::unix::fs::PermissionsExt;
    use std::time::Duration;

    use flate2::Compression;
    use flate2::write::GzEncoder;
    use tar::{Builder, EntryType, Header};

    use crate::runtime::plan::RuntimeArtifactGitHubReleaseBinaryAssetShape;
    use crate::time::testing::{ManualSleeper, MutableClock};

    use super::{
        GitHubReleaseAssetResponse, GitHubReleaseResponse, InstallWorkspace, RetryableFailure,
        RuntimeArtifactGitHubReleaseAssetShape, RuntimeArtifactGitHubReleaseInstallAsset,
        StepBudget, apply_managed_github_client_env, build_mise_install_command,
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
    fn github_release_client_rejects_invalid_managed_proxy_url() {
        let managed_env = BTreeMap::from([("HTTPS_PROXY".to_string(), "://bad".to_string())]);

        let error =
            apply_managed_github_client_env(reqwest::blocking::Client::builder(), &managed_env)
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
            "rust-v0.132.0",
            "codex-x86_64-unknown-linux-musl.tar.gz",
        )
        .expect("exact tag asset url should build");

        assert_eq!(
            url.as_str(),
            "https://github.com/openai/codex/releases/download/rust-v0.132.0/codex-x86_64-unknown-linux-musl.tar.gz"
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
        let archive_bytes =
            create_tar_gz_bytes("gh_2.0.0_linux_amd64/bin/gh", b"#!/bin/sh\necho gh\n");
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
            fs::read(install_path.join("theme/dark.json"))
                .expect("installed theme asset should exist"),
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
}
