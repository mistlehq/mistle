package runtime

import (
	"archive/tar"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	goruntime "runtime"
	"strings"
	"time"

	"github.com/mistle/sandboxd/command"
)

const (
	installedBinaryMode      = 0o755
	githubInstallerUserAgent = "mistle-sandboxd-artifact-installer"
)

var (
	githubAPIBaseURL      = "https://api.github.com"
	githubReleasesBaseURL = "https://github.com"
	githubRetryBackoffs   = []time.Duration{time.Second, 2 * time.Second}
)

func ApplyArtifactInstallStep(installStep RuntimeArtifactInstallStep, managedEnv map[string]string) error {
	return ApplyArtifactInstallStepWithOutputSink(installStep, managedEnv, nil)
}

func ApplyArtifactInstallStepWithOutputSink(installStep RuntimeArtifactInstallStep, managedEnv map[string]string, outputSink command.OutputSink) error {
	switch installStep.Op {
	case RuntimeArtifactInstallOpExec:
		return applyArtifactExecCommand(installStep.Command, managedEnv, outputSink)
	case RuntimeArtifactInstallOpMiseInstall:
		return applyArtifactExecCommand(buildMiseInstallCommand(installStep), managedEnv, outputSink)
	case RuntimeArtifactInstallOpGitHubReleaseInstall:
		return applyGitHubReleaseInstall(installStep, managedEnv)
	default:
		return fmt.Errorf("unsupported artifact install op %s", installStep.Op)
	}
}

func applyArtifactExecCommand(execCommand RuntimeExecCommand, managedEnv map[string]string, outputSink command.OutputSink) error {
	env, err := mergeArtifactExecEnvironment(execCommand.Env, managedEnv)
	if err != nil {
		return err
	}
	failure := command.RunWithDetailsAndOutputSink(command.Spec{
		Args:      execCommand.Args,
		Env:       env,
		CWD:       execCommand.CWD,
		TimeoutMS: execCommand.TimeoutMS,
	}, outputSink)
	if failure != nil {
		return fmt.Errorf("%s", failure.Message)
	}
	return nil
}

func buildMiseInstallCommand(installStep RuntimeArtifactInstallStep) RuntimeExecCommand {
	args := []string{"mise", "install"}
	if installStep.Force != nil && *installStep.Force {
		args = append(args, "--force")
	}
	args = append(args, installStep.Tools...)
	return RuntimeExecCommand{
		Args:      args,
		TimeoutMS: installStep.TimeoutMS,
	}
}

func mergeArtifactExecEnvironment(commandEnv map[string]string, managedEnv map[string]string) (map[string]string, error) {
	if len(commandEnv) == 0 && len(managedEnv) == 0 {
		return nil, nil
	}
	merged := make(map[string]string, len(commandEnv)+len(managedEnv))
	for key, value := range commandEnv {
		merged[key] = value
	}
	for key, value := range managedEnv {
		if existingValue, ok := merged[key]; ok && existingValue != value {
			return nil, fmt.Errorf("artifact install command env defines managed env '%s', which sandboxd reserves", key)
		}
		merged[key] = value
	}
	return merged, nil
}

func applyGitHubReleaseInstall(installStep RuntimeArtifactInstallStep, managedEnv map[string]string) error {
	if installStep.Repository == "" {
		return fmt.Errorf("github release repository is required")
	}
	if installStep.InstallPath == "" {
		return fmt.Errorf("github release installPath is required")
	}
	assetShape, err := selectGitHubReleaseAssetShape(installStep.Asset)
	if err != nil {
		return err
	}
	assetName := assetShape.FileName
	if assetName == "" {
		return fmt.Errorf("github release asset fileName is required")
	}
	client, err := buildGitHubClient(managedEnv)
	if err != nil {
		return err
	}
	budget := newGitHubInstallBudget(installStep.TimeoutMS)
	downloadURL, err := resolveGitHubReleaseAssetDownloadURL(client, budget, installStep.Repository, installStep.Release, assetName)
	if err != nil {
		return err
	}
	workspace, err := newInstallWorkspace(installStep.InstallPath)
	if err != nil {
		return err
	}
	defer workspace.cleanup()
	context := fmt.Sprintf(
		"github release asset download failed for %s release %s asset %s",
		installStep.Repository,
		describeGitHubReleaseSelector(installStep.Release),
		assetName,
	)
	if err := downloadGitHubAssetToPath(client, budget, downloadURL, workspace.downloadPath, context); err != nil {
		return err
	}
	if _, err := budget.remainingTimeout(); err != nil {
		return err
	}
	if err := verifyFileSHA256(workspace.downloadPath, assetShape.SHA256, context); err != nil {
		return err
	}
	if _, err := budget.remainingTimeout(); err != nil {
		return err
	}
	if err := materializeGitHubReleaseAsset(workspace, assetShape, budget); err != nil {
		return fmt.Errorf(
			"github release asset install failed for %s release %s asset %s installPath=%s: %w",
			installStep.Repository,
			describeGitHubReleaseSelector(installStep.Release),
			assetName,
			installStep.InstallPath,
			err,
		)
	}
	workspace.finalized = true
	return nil
}

func selectGitHubReleaseAssetShape(asset RuntimeArtifactGitHubReleaseInstallAsset) (RuntimeArtifactGitHubReleaseAssetShape, error) {
	switch asset.Kind {
	case RuntimeArtifactGitHubReleaseInstallAssetKindByArch:
		switch goruntime.GOARCH {
		case "amd64":
			return asset.X86_64, nil
		case "arm64":
			return asset.Aarch64, nil
		default:
			return RuntimeArtifactGitHubReleaseAssetShape{}, fmt.Errorf("github release install does not support runtime architecture %s", goruntime.GOARCH)
		}
	case RuntimeArtifactGitHubReleaseInstallAssetKindExact, "":
		return asset.Exact, nil
	default:
		return RuntimeArtifactGitHubReleaseAssetShape{}, fmt.Errorf("unsupported github release install asset kind %s", asset.Kind)
	}
}

func resolveGitHubReleaseAssetDownloadURL(client *http.Client, budget githubInstallBudget, repository string, release RuntimeArtifactGitHubReleaseSelector, assetName string) (string, error) {
	if release.Kind == RuntimeArtifactGitHubReleaseSelectorTag && release.Match == RuntimeArtifactGitHubReleaseTagMatchExact {
		if release.Tag == "" {
			return "", fmt.Errorf("github release exact tag is required")
		}
		return githubReleaseAssetDownloadURL(repository, release.Tag, assetName)
	}
	resolvedRelease, err := resolveGitHubRelease(client, budget, repository, release)
	if err != nil {
		return "", err
	}
	for _, asset := range resolvedRelease.Assets {
		if asset.Name == assetName {
			return asset.BrowserDownloadURL, nil
		}
	}
	return "", fmt.Errorf(
		"github release asset lookup failed for %s release %s resolved tag %s: asset %s not found",
		repository,
		describeGitHubReleaseSelector(release),
		resolvedRelease.TagName,
		assetName,
	)
}

func githubReleaseAssetDownloadURL(repository string, tag string, assetName string) (string, error) {
	if err := validateGitHubRepository(repository); err != nil {
		return "", err
	}
	baseURL, err := url.Parse(githubReleasesBaseURL)
	if err != nil {
		return "", err
	}
	segments := strings.Split(repository, "/")
	segments = append(segments, "releases", "download", tag, assetName)
	baseURL.Path = pathFromSegments(segments)
	return baseURL.String(), nil
}

func resolveGitHubRelease(client *http.Client, budget githubInstallBudget, repository string, release RuntimeArtifactGitHubReleaseSelector) (githubReleaseResponse, error) {
	switch release.Kind {
	case RuntimeArtifactGitHubReleaseSelectorLatest:
		requestURL, err := githubAPIURL(repository, []string{"releases", "latest"}, nil)
		if err != nil {
			return githubReleaseResponse{}, err
		}
		return requestGitHubJSON[githubReleaseResponse](
			client,
			budget,
			requestURL,
			fmt.Sprintf("github release lookup failed for %s release %s", repository, describeGitHubReleaseSelector(release)),
		)
	case RuntimeArtifactGitHubReleaseSelectorTag:
		switch release.Match {
		case RuntimeArtifactGitHubReleaseTagMatchExact:
			requestURL, err := githubAPIURL(repository, []string{"releases", "tags", release.Tag}, nil)
			if err != nil {
				return githubReleaseResponse{}, err
			}
			return requestGitHubJSON[githubReleaseResponse](
				client,
				budget,
				requestURL,
				fmt.Sprintf("github release lookup failed for %s release %s", repository, describeGitHubReleaseSelector(release)),
			)
		case RuntimeArtifactGitHubReleaseTagMatchLatestMatchingPrefix:
			return resolveLatestMatchingReleasePrefix(client, budget, repository, release.Prefix, release)
		default:
			return githubReleaseResponse{}, fmt.Errorf("unsupported github release tag match %s", release.Match)
		}
	default:
		return githubReleaseResponse{}, fmt.Errorf("unsupported github release selector kind %s", release.Kind)
	}
}

func resolveLatestMatchingReleasePrefix(client *http.Client, budget githubInstallBudget, repository string, prefix string, release RuntimeArtifactGitHubReleaseSelector) (githubReleaseResponse, error) {
	if prefix == "" {
		return githubReleaseResponse{}, fmt.Errorf("github release latest_matching_prefix prefix is required")
	}
	for page := 1; ; page++ {
		requestURL, err := githubAPIURL(repository, []string{"releases"}, map[string]string{
			"per_page": "100",
			"page":     fmt.Sprintf("%d", page),
		})
		if err != nil {
			return githubReleaseResponse{}, err
		}
		releases, err := requestGitHubJSON[[]githubReleaseResponse](
			client,
			budget,
			requestURL,
			fmt.Sprintf("github release lookup failed for %s release %s page=%d", repository, describeGitHubReleaseSelector(release), page),
		)
		if err != nil {
			return githubReleaseResponse{}, err
		}
		if len(releases) == 0 {
			return githubReleaseResponse{}, fmt.Errorf("github release lookup failed for %s release %s: no published release matched", repository, describeGitHubReleaseSelector(release))
		}
		for _, candidate := range releases {
			if candidate.PublishedAt != nil && !candidate.Draft && !candidate.Prerelease && strings.HasPrefix(candidate.TagName, prefix) {
				return candidate, nil
			}
		}
	}
}

func githubAPIURL(repository string, segments []string, query map[string]string) (string, error) {
	if err := validateGitHubRepository(repository); err != nil {
		return "", err
	}
	baseURL, err := url.Parse(githubAPIBaseURL)
	if err != nil {
		return "", err
	}
	pathSegments := append([]string{"repos"}, strings.Split(repository, "/")...)
	pathSegments = append(pathSegments, segments...)
	baseURL.Path = pathFromSegments(pathSegments)
	if len(query) > 0 {
		values := url.Values{}
		for key, value := range query {
			values.Set(key, value)
		}
		baseURL.RawQuery = values.Encode()
	}
	return baseURL.String(), nil
}

func requestGitHubJSON[T any](client *http.Client, budget githubInstallBudget, requestURL string, failureContext string) (T, error) {
	var result T
	request, err := http.NewRequest(http.MethodGet, requestURL, nil)
	if err != nil {
		return result, fmt.Errorf("github api url is invalid: %w", err)
	}
	request.Header.Set("Accept", "application/vnd.github+json")
	request.Header.Set("User-Agent", githubInstallerUserAgent)
	response, err := sendGitHubRequestWithRetry(client, budget, request, failureContext)
	if err != nil {
		return result, err
	}
	defer response.Body.Close()
	if err := json.NewDecoder(response.Body).Decode(&result); err != nil {
		return result, fmt.Errorf("github api returned invalid json: %w", err)
	}
	return result, nil
}

type githubReleaseResponse struct {
	TagName     string                       `json:"tag_name"`
	Draft       bool                         `json:"draft"`
	Prerelease  bool                         `json:"prerelease"`
	PublishedAt *string                      `json:"published_at"`
	Assets      []githubReleaseAssetResponse `json:"assets"`
}

type githubReleaseAssetResponse struct {
	Name               string `json:"name"`
	BrowserDownloadURL string `json:"browser_download_url"`
}

func validateGitHubRepository(repository string) error {
	segments := strings.Split(repository, "/")
	if len(segments) != 2 || segments[0] == "" || segments[1] == "" {
		return fmt.Errorf("github repository path is invalid: %s", repository)
	}
	return nil
}

func pathFromSegments(segments []string) string {
	escaped := make([]string, 0, len(segments))
	for _, segment := range segments {
		escaped = append(escaped, url.PathEscape(segment))
	}
	return "/" + strings.Join(escaped, "/")
}

func describeGitHubReleaseSelector(selector RuntimeArtifactGitHubReleaseSelector) string {
	switch selector.Kind {
	case RuntimeArtifactGitHubReleaseSelectorLatest:
		return "kind=latest"
	case RuntimeArtifactGitHubReleaseSelectorTag:
		switch selector.Match {
		case RuntimeArtifactGitHubReleaseTagMatchExact:
			return "tag match=exact tag=" + selector.Tag
		case RuntimeArtifactGitHubReleaseTagMatchLatestMatchingPrefix:
			return "tag match=latest_matching_prefix prefix=" + selector.Prefix
		default:
			return "tag match=" + string(selector.Match)
		}
	default:
		return "kind=" + string(selector.Kind)
	}
}

func downloadGitHubAssetToPath(client *http.Client, budget githubInstallBudget, downloadURL string, downloadPath string, failureContext string) error {
	request, err := http.NewRequest(http.MethodGet, downloadURL, nil)
	if err != nil {
		return fmt.Errorf("github release asset download url is invalid: %w", err)
	}
	request.Header.Set("User-Agent", githubInstallerUserAgent)
	return runGitHubWithRetry(budget, func(requestContext context.Context) retryableGitHubFailure {
		file, err := os.Create(downloadPath)
		if err != nil {
			return retryableGitHubFailure{message: fmt.Sprintf("failed to create download staging file: %v", err)}
		}
		defer file.Close()
		response, failure := doGitHubRequest(client, request.WithContext(requestContext), failureContext)
		if failure != nil {
			return *failure
		}
		defer response.Body.Close()
		if _, err := io.Copy(file, response.Body); err != nil {
			return retryableGitHubFailure{message: fmt.Sprintf("%s: %v", failureContext, err), retryable: true}
		}
		return retryableGitHubFailure{}
	})
}

func buildGitHubClient(managedEnv map[string]string) (*http.Client, error) {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.Proxy = nil
	if managedEnv != nil {
		proxyURL := firstManagedEnvValue(managedEnv, "HTTPS_PROXY", "https_proxy", "ALL_PROXY", "all_proxy")
		if proxyURL != "" {
			parsedProxyURL, err := url.Parse(proxyURL)
			if err != nil {
				return nil, fmt.Errorf("managed HTTPS proxy configuration is invalid for github release install: %w", err)
			}
			transport.Proxy = http.ProxyURL(parsedProxyURL)
		}
		certificatePath := firstManagedEnvValue(managedEnv, "SSL_CERT_FILE", "CURL_CA_BUNDLE")
		if certificatePath != "" {
			certificates, err := os.ReadFile(certificatePath)
			if err != nil {
				return nil, fmt.Errorf("failed to read managed certificate bundle for github release install '%s': %w", certificatePath, err)
			}
			pool, err := x509.SystemCertPool()
			if err != nil {
				return nil, fmt.Errorf("failed to load system certificate pool for github release install: %w", err)
			}
			if !pool.AppendCertsFromPEM(certificates) {
				return nil, fmt.Errorf("managed certificate bundle for github release install '%s' is invalid", certificatePath)
			}
			transport.TLSClientConfig = &tls.Config{RootCAs: pool}
		}
	}
	return &http.Client{Transport: transport}, nil
}

func firstManagedEnvValue(managedEnv map[string]string, keys ...string) string {
	for _, key := range keys {
		if value, ok := managedEnv[key]; ok {
			return value
		}
	}
	return ""
}

type githubInstallBudget struct {
	timeoutMS *uint64
	startedAt time.Time
}

func newGitHubInstallBudget(timeoutMS *uint64) githubInstallBudget {
	return githubInstallBudget{timeoutMS: timeoutMS, startedAt: time.Now()}
}

func (budget githubInstallBudget) remainingTimeout() (time.Duration, error) {
	if budget.timeoutMS == nil {
		return 0, nil
	}
	timeout := time.Duration(*budget.timeoutMS) * time.Millisecond
	remaining := timeout - time.Since(budget.startedAt)
	if remaining <= 0 {
		return 0, fmt.Errorf("github release install timed out after %dms", *budget.timeoutMS)
	}
	return remaining, nil
}

func (budget githubInstallBudget) ensureCanWait(duration time.Duration) error {
	remaining, err := budget.remainingTimeout()
	if err != nil || budget.timeoutMS == nil {
		return err
	}
	if remaining <= duration {
		return fmt.Errorf("github release install timed out after %dms", *budget.timeoutMS)
	}
	return nil
}

type retryableGitHubFailure struct {
	message   string
	retryable bool
}

func runGitHubWithRetry(budget githubInstallBudget, operation func(context.Context) retryableGitHubFailure) error {
	for attempt := 0; attempt < 3; attempt++ {
		remaining, err := budget.remainingTimeout()
		if err != nil {
			return err
		}
		requestContext := context.Background()
		cancel := func() {}
		if budget.timeoutMS != nil {
			requestContext, cancel = context.WithTimeout(requestContext, remaining)
		}
		failure := operation(requestContext)
		cancel()
		if failure.message == "" {
			return nil
		}
		if !failure.retryable || attempt == 2 {
			if attempt > 0 {
				return fmt.Errorf("%s after %d attempts", failure.message, attempt+1)
			}
			return fmt.Errorf("%s", failure.message)
		}
		backoff := githubRetryBackoffs[attempt]
		if err := budget.ensureCanWait(backoff); err != nil {
			return err
		}
		time.Sleep(backoff)
	}
	return fmt.Errorf("github release retry loop exhausted unexpectedly")
}

func sendGitHubRequestWithRetry(client *http.Client, budget githubInstallBudget, request *http.Request, failureContext string) (*http.Response, error) {
	var response *http.Response
	err := runGitHubWithRetry(budget, func(requestContext context.Context) retryableGitHubFailure {
		attemptRequest := request.Clone(requestContext)
		currentResponse, failure := doGitHubRequest(client, attemptRequest, failureContext)
		if failure != nil {
			return *failure
		}
		response = currentResponse
		return retryableGitHubFailure{}
	})
	if err != nil {
		return nil, err
	}
	return response, nil
}

func doGitHubRequest(client *http.Client, request *http.Request, failureContext string) (*http.Response, *retryableGitHubFailure) {
	response, err := client.Do(request)
	if err != nil {
		return nil, &retryableGitHubFailure{message: fmt.Sprintf("%s: %v", failureContext, err), retryable: isRetryableNetworkError(err)}
	}
	if response.StatusCode >= 200 && response.StatusCode < 300 {
		return response, nil
	}
	_ = response.Body.Close()
	return nil, &retryableGitHubFailure{
		message:   fmt.Sprintf("%s: http %d%s", failureContext, response.StatusCode, githubFailureResponseDetails(response)),
		retryable: isRetryableGitHubHTTPStatus(response.StatusCode),
	}
}

func githubFailureResponseDetails(response *http.Response) string {
	if response == nil {
		return ""
	}
	details := []string{}
	if response.Request != nil && response.Request.URL != nil {
		details = append(details, "url="+redactURLQuery(response.Request.URL))
		if response.Request.URL.Host != "" {
			details = append(details, "host="+response.Request.URL.Host)
		}
	}
	if server := response.Header.Get("Server"); server != "" {
		details = append(details, "server="+server)
	}
	if requestID := response.Header.Get("X-GitHub-Request-Id"); requestID != "" {
		details = append(details, "githubRequestId="+requestID)
	}
	if len(details) == 0 {
		return ""
	}
	return " (" + strings.Join(details, " ") + ")"
}

func redactURLQuery(parsedURL *url.URL) string {
	if parsedURL == nil {
		return ""
	}
	redacted := *parsedURL
	if redacted.RawQuery != "" {
		redacted.RawQuery = "<redacted>"
	}
	return redacted.String()
}

func isRetryableNetworkError(err error) bool {
	return true
}

func isRetryableGitHubHTTPStatus(statusCode int) bool {
	return statusCode == http.StatusForbidden || statusCode == http.StatusTooManyRequests || statusCode >= 500
}

func verifyFileSHA256(path string, expectedSHA256 *string, failureContext string) error {
	if expectedSHA256 == nil {
		return nil
	}
	file, err := os.Open(path)
	if err != nil {
		return fmt.Errorf("failed to open downloaded github release asset for sha256: %w", err)
	}
	defer file.Close()
	hash := sha256.New()
	if _, err := io.Copy(hash, file); err != nil {
		return fmt.Errorf("failed to read downloaded github release asset for sha256: %w", err)
	}
	actual := hex.EncodeToString(hash.Sum(nil))
	if actual != *expectedSHA256 {
		return fmt.Errorf("%s: sha256 mismatch expected %s got %s", failureContext, *expectedSHA256, actual)
	}
	return nil
}

type installWorkspace struct {
	tempDir      string
	downloadPath string
	stagedPath   string
	installPath  string
	finalized    bool
}

func newInstallWorkspace(installPath string) (*installWorkspace, error) {
	parent := filepath.Dir(installPath)
	if parent == "." || parent == "" {
		parent = "."
	}
	parentMetadata, err := os.Stat(parent)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, fmt.Errorf("github release install parent directory does not exist: %s", parent)
		}
		return nil, fmt.Errorf("failed to inspect github release install parent directory: %w", err)
	}
	if !parentMetadata.IsDir() {
		return nil, fmt.Errorf("github release install parent path is not a directory: %s", parent)
	}
	tempDir, err := os.MkdirTemp(parent, ".mistle-artifact-*")
	if err != nil {
		return nil, fmt.Errorf("failed to create staged install directory: %w", err)
	}
	return &installWorkspace{
		tempDir:      tempDir,
		downloadPath: filepath.Join(tempDir, "downloaded-asset"),
		stagedPath:   filepath.Join(tempDir, "staged-asset"),
		installPath:  installPath,
	}, nil
}

func (workspace *installWorkspace) cleanup() {
	if workspace != nil {
		_ = os.RemoveAll(workspace.tempDir)
	}
}

func materializeGitHubReleaseAsset(workspace *installWorkspace, assetShape RuntimeArtifactGitHubReleaseAssetShape, budget githubInstallBudget) error {
	switch assetShape.Format {
	case RuntimeArtifactGitHubReleaseAssetFormatBinary:
		if assetShape.ExtractedPath != "" {
			return fmt.Errorf("binary assets must not include extractedPath")
		}
		if _, err := budget.remainingTimeout(); err != nil {
			return err
		}
		if err := os.Chmod(workspace.downloadPath, installedBinaryMode); err != nil {
			return fmt.Errorf("failed to mark installed artifact executable: %w", err)
		}
		if _, err := budget.remainingTimeout(); err != nil {
			return err
		}
		return finalizeInstall(workspace.downloadPath, workspace.installPath)
	case RuntimeArtifactGitHubReleaseAssetFormatTarGz:
		if assetShape.ExtractedPath == "" {
			return fmt.Errorf("tar.gz assets must include extractedPath")
		}
		if _, err := budget.remainingTimeout(); err != nil {
			return err
		}
		if err := installTarGzEntry(workspace.downloadPath, assetShape.ExtractedPath, workspace.stagedPath, budget); err != nil {
			return err
		}
		if _, err := budget.remainingTimeout(); err != nil {
			return err
		}
		if err := setExecutablePermissionsIfFile(workspace.stagedPath); err != nil {
			return err
		}
		if _, err := budget.remainingTimeout(); err != nil {
			return err
		}
		return finalizeInstall(workspace.stagedPath, workspace.installPath)
	default:
		return fmt.Errorf("unsupported github release asset format %s", assetShape.Format)
	}
}

func finalizeInstall(sourcePath string, installPath string) error {
	if err := os.Rename(sourcePath, installPath); err != nil {
		return fmt.Errorf("failed to move staged install into place: %w", err)
	}
	return nil
}

func installTarGzEntry(archivePath string, extractedPath string, stagedPath string, budget githubInstallBudget) error {
	file, err := os.Open(archivePath)
	if err != nil {
		return fmt.Errorf("failed to open downloaded github release archive: %w", err)
	}
	defer file.Close()
	gzipReader, err := gzip.NewReader(file)
	if err != nil {
		return fmt.Errorf("failed to read github release tar.gz entries for %s: %w", extractedPath, err)
	}
	defer gzipReader.Close()
	archiveReader := tar.NewReader(gzipReader)
	foundEntry := false
	for {
		if _, err := budget.remainingTimeout(); err != nil {
			return err
		}
		header, err := archiveReader.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return fmt.Errorf("failed to read github release tar.gz entry: %w", err)
		}
		relativePath, ok, err := tarGzEntryRelativePath(header.Name, extractedPath)
		if err != nil {
			return err
		}
		if !ok {
			continue
		}
		destinationPath := stagedPath
		if relativePath != "" {
			destinationPath = filepath.Join(stagedPath, relativePath)
		}
		switch header.Typeflag {
		case tar.TypeDir:
			if _, err := budget.remainingTimeout(); err != nil {
				return err
			}
			mode := tarEntryMode(header, 0o755)
			if err := os.MkdirAll(destinationPath, mode); err != nil {
				return fmt.Errorf("failed to create staged install directory from tar.gz: %w", err)
			}
			if err := os.Chmod(destinationPath, mode); err != nil {
				return fmt.Errorf("failed to set staged install directory mode from tar.gz: %w", err)
			}
			foundEntry = true
		case tar.TypeReg:
			if _, err := budget.remainingTimeout(); err != nil {
				return err
			}
			if err := os.MkdirAll(filepath.Dir(destinationPath), 0o755); err != nil {
				return fmt.Errorf("failed to create staged install parent directory from tar.gz: %w", err)
			}
			output, err := os.OpenFile(destinationPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, tarEntryMode(header, 0o644))
			if err != nil {
				return fmt.Errorf("failed to extract github release tar.gz entry: %w", err)
			}
			if _, err := io.Copy(output, archiveReader); err != nil {
				_ = output.Close()
				return fmt.Errorf("failed to extract github release tar.gz entry: %w", err)
			}
			if err := output.Close(); err != nil {
				return fmt.Errorf("failed to extract github release tar.gz entry: %w", err)
			}
			if err := os.Chmod(destinationPath, tarEntryMode(header, 0o644)); err != nil {
				return fmt.Errorf("failed to set github release tar.gz entry mode: %w", err)
			}
			foundEntry = true
			if header.Name == extractedPath {
				return nil
			}
		default:
			return fmt.Errorf("github release tar.gz entry %s is not a regular file or directory", header.Name)
		}
	}
	if !foundEntry {
		return fmt.Errorf("github release tar.gz did not contain extractedPath=%s", extractedPath)
	}
	return nil
}

func tarEntryMode(header *tar.Header, defaultMode os.FileMode) os.FileMode {
	mode := os.FileMode(header.Mode).Perm()
	if mode == 0 {
		return defaultMode
	}
	return mode
}

func tarGzEntryRelativePath(entryPath string, extractedPath string) (string, bool, error) {
	if entryPath == extractedPath {
		return "", true, nil
	}
	prefix := extractedPath + string(os.PathSeparator)
	if !strings.HasPrefix(entryPath, prefix) {
		return "", false, nil
	}
	relativePath := strings.TrimPrefix(entryPath, prefix)
	if err := validateArchiveRelativePath(relativePath, entryPath); err != nil {
		return "", false, err
	}
	return relativePath, true, nil
}

func validateArchiveRelativePath(relativePath string, entryPath string) error {
	if relativePath == "" {
		return nil
	}
	for _, part := range strings.Split(relativePath, string(os.PathSeparator)) {
		if part == ".." {
			return fmt.Errorf("github release tar.gz entry %s escapes extractedPath", entryPath)
		}
	}
	return nil
}

func setExecutablePermissionsIfFile(path string) error {
	metadata, err := os.Stat(path)
	if err != nil {
		return fmt.Errorf("failed to read installed artifact metadata: %w", err)
	}
	if metadata.IsDir() {
		return nil
	}
	if err := os.Chmod(path, installedBinaryMode); err != nil {
		return fmt.Errorf("failed to mark installed artifact executable: %w", err)
	}
	return nil
}
