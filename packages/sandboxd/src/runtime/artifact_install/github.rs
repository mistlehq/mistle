use std::collections::BTreeMap;
use std::fs;
use std::path::Path;

use reqwest::blocking::{Client, ClientBuilder, Response};
use reqwest::header::ACCEPT;
use reqwest::{Certificate, Proxy, StatusCode, Url};
use serde::Deserialize;

use crate::runtime::artifact_install::*;
use crate::runtime::plan::{
    RuntimeArtifactGitHubReleaseAssetShape, RuntimeArtifactGitHubReleaseInstallAsset,
    RuntimeArtifactGitHubReleaseSelector, RuntimeArtifactGitHubReleaseTagSelector,
};
use crate::time::{Clock, Sleeper};

pub(super) fn apply_github_release_install<C, S>(
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

pub(super) fn resolve_github_release_asset_download_url<C, S>(
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

pub(super) fn build_github_client(
    managed_env: Option<&BTreeMap<String, String>>,
) -> Result<Client, String> {
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

pub(super) fn apply_managed_github_client_env(
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

pub(super) fn resolve_github_release<C, S>(
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

pub(super) fn resolve_latest_matching_release_prefix<C, S>(
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

pub(super) fn request_github_json<T, C, S>(
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

pub(super) fn download_github_asset_to_path<C, S>(
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

pub(super) fn send_github_request_with_retry<C, S>(
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

pub(super) fn materialize_github_release_asset<C>(
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

pub(super) fn select_release_asset_shape(
    asset: &RuntimeArtifactGitHubReleaseInstallAsset,
) -> Result<&RuntimeArtifactGitHubReleaseAssetShape, String> {
    select_release_asset_shape_for_arch(asset, std::env::consts::ARCH)
}

pub(super) fn select_release_asset_shape_for_arch<'a>(
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

pub(super) fn github_release_asset_shape_file_name(
    asset_shape: &RuntimeArtifactGitHubReleaseAssetShape,
) -> &str {
    match asset_shape {
        RuntimeArtifactGitHubReleaseAssetShape::Binary(shape) => &shape.file_name,
        RuntimeArtifactGitHubReleaseAssetShape::TarGz(shape) => &shape.file_name,
    }
}

pub(super) fn github_release_asset_shape_sha256(
    asset_shape: &RuntimeArtifactGitHubReleaseAssetShape,
) -> Option<&str> {
    match asset_shape {
        RuntimeArtifactGitHubReleaseAssetShape::Binary(shape) => shape.sha256.as_deref(),
        RuntimeArtifactGitHubReleaseAssetShape::TarGz(shape) => shape.sha256.as_deref(),
    }
}

pub(super) fn github_api_url(
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

pub(super) fn github_release_asset_download_url(
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

pub(super) fn describe_release_selector(selector: &RuntimeArtifactGitHubReleaseSelector) -> String {
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

pub(super) fn find_first_matching_published_release<'a>(
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

pub(super) fn is_retryable_http_status(status: StatusCode) -> bool {
    status == StatusCode::FORBIDDEN
        || status == StatusCode::TOO_MANY_REQUESTS
        || status.is_server_error()
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub(super) struct GitHubReleaseResponse {
    pub(super) tag_name: String,
    pub(super) draft: bool,
    pub(super) prerelease: bool,
    pub(super) published_at: Option<String>,
    pub(super) assets: Vec<GitHubReleaseAssetResponse>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub(super) struct GitHubReleaseAssetResponse {
    pub(super) name: String,
    pub(super) browser_download_url: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum RequestKind {
    Api,
}
