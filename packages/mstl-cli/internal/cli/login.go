package cli

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os/exec"
	"runtime"
	"strings"
	"time"

	mstlcore "github.com/mistle/mstl-core"
)

const (
	cliClientID  = "mistle-cli"
	callbackHost = "127.0.0.1"
	callbackPath = "/callback"
)

type authorizationURLInput struct {
	BaseURL       string
	RedirectURI   string
	Resource      string
	State         string
	CodeChallenge string
}

type tokenExchangeInput struct {
	BaseURL      string
	Code         string
	RedirectURI  string
	Resource     string
	CodeVerifier string
}

func runLogin(stdout io.Writer) error {
	baseURL, err := controlPlaneAPIPublicURL()
	if err != nil {
		return err
	}

	listener, err := net.Listen("tcp", callbackHost+":0")
	if err != nil {
		return fmt.Errorf("failed to bind local callback server: %w", err)
	}
	defer listener.Close()

	redirectURI := fmt.Sprintf("http://%s%s", listener.Addr().String(), callbackPath)
	state, err := randomURLSafeToken()
	if err != nil {
		return err
	}
	codeVerifier, err := randomURLSafeToken()
	if err != nil {
		return err
	}
	codeChallenge := pkceS256Challenge(codeVerifier)
	authorizationURL, err := buildAuthorizationURL(authorizationURLInput{
		BaseURL:       baseURL,
		RedirectURI:   redirectURI,
		Resource:      baseURL,
		State:         state,
		CodeChallenge: codeChallenge,
	})
	if err != nil {
		return err
	}

	if _, err := fmt.Fprintln(stdout, "Opening browser for Mistle login..."); err != nil {
		return fmt.Errorf("failed to write login status: %w", err)
	}
	if err := openBrowser(authorizationURL.String()); err != nil {
		return err
	}

	callbackCode, err := waitForCallback(listener, state)
	if err != nil {
		return err
	}
	token, err := exchangeAuthorizationCode(tokenExchangeInput{
		BaseURL:      baseURL,
		Code:         callbackCode,
		RedirectURI:  redirectURI,
		Resource:     baseURL,
		CodeVerifier: codeVerifier,
	})
	if err != nil {
		return err
	}
	auth, err := oauthTokenResponseToAuth(token)
	if err != nil {
		return err
	}
	authFilePath, err := writeOAuth(auth)
	if err != nil {
		return err
	}

	if _, err := fmt.Fprintln(stdout, "Logged in to Mistle"); err != nil {
		return fmt.Errorf("failed to write login result: %w", err)
	}
	if _, err := fmt.Fprintf(stdout, "Wrote auth file: %s\n", authFilePath); err != nil {
		return fmt.Errorf("failed to write login result: %w", err)
	}
	return nil
}

func buildAuthorizationURL(input authorizationURLInput) (*url.URL, error) {
	authorizationURL, err := url.Parse(input.BaseURL)
	if err != nil {
		return nil, fmt.Errorf("failed to parse control plane API URL: %w", err)
	}
	authorizationURL.Path = strings.TrimRight(authorizationURL.Path, "/") + "/oauth/authorize"
	query := authorizationURL.Query()
	query.Set("response_type", "code")
	query.Set("client_id", cliClientID)
	query.Set("redirect_uri", input.RedirectURI)
	query.Set("resource", input.Resource)
	query.Set("state", input.State)
	query.Set("code_challenge", input.CodeChallenge)
	query.Set("code_challenge_method", "S256")
	authorizationURL.RawQuery = query.Encode()
	return authorizationURL, nil
}

func waitForCallback(listener net.Listener, expectedState string) (string, error) {
	server := &http.Server{}
	codeChannel := make(chan callbackResult, 1)
	server.Handler = http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		code, err := readCallback(request, expectedState)
		if err != nil {
			http.Error(response, "Mistle login failed. Return to your terminal for details.", http.StatusBadRequest)
			codeChannel <- callbackResult{Err: err}
			return
		}
		_, _ = response.Write([]byte("Mistle login complete. You can close this window."))
		codeChannel <- callbackResult{Code: code}
	})

	go func() {
		err := server.Serve(listener)
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			codeChannel <- callbackResult{Err: fmt.Errorf("failed to accept local login callback: %w", err)}
		}
	}()

	result := <-codeChannel
	_ = server.Close()
	if result.Err != nil {
		return "", result.Err
	}
	return result.Code, nil
}

type callbackResult struct {
	Code string
	Err  error
}

func readCallback(request *http.Request, expectedState string) (string, error) {
	if request.Method != http.MethodGet {
		return "", errors.New("failed to read local login callback: callback request must use GET")
	}
	if request.URL.Path != callbackPath {
		return "", errors.New("failed to read local login callback: callback path is invalid")
	}
	code := request.URL.Query().Get("code")
	state := request.URL.Query().Get("state")
	if code == "" || state == "" {
		return "", errors.New("failed to read local login callback: callback is missing required query parameter")
	}
	if state != expectedState {
		return "", errors.New("failed to read local login callback: callback state is invalid")
	}
	return code, nil
}

func exchangeAuthorizationCode(input tokenExchangeInput) (mstlcore.OAuthTokenResponse, error) {
	tokenURL, err := tokenURL(input.BaseURL)
	if err != nil {
		return mstlcore.OAuthTokenResponse{}, err
	}
	form := url.Values{}
	form.Set("grant_type", "authorization_code")
	form.Set("client_id", cliClientID)
	form.Set("redirect_uri", input.RedirectURI)
	form.Set("resource", input.Resource)
	form.Set("code", input.Code)
	form.Set("code_verifier", input.CodeVerifier)

	response, err := http.PostForm(tokenURL.String(), form)
	if err != nil {
		return mstlcore.OAuthTokenResponse{}, fmt.Errorf("failed to exchange authorization code: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return mstlcore.OAuthTokenResponse{}, fmt.Errorf("failed to exchange authorization code: unexpected status %d", response.StatusCode)
	}

	var token mstlcore.OAuthTokenResponse
	if err := json.NewDecoder(response.Body).Decode(&token); err != nil {
		return mstlcore.OAuthTokenResponse{}, fmt.Errorf("failed to decode token response: %w", err)
	}
	return token, nil
}

func refreshOAuthAuth(baseURL string, refreshToken string) (oauthAuth, error) {
	tokenURL, err := tokenURL(baseURL)
	if err != nil {
		return oauthAuth{}, err
	}
	form := url.Values{}
	form.Set("grant_type", "refresh_token")
	form.Set("client_id", cliClientID)
	form.Set("resource", baseURL)
	form.Set("refresh_token", refreshToken)

	response, err := http.PostForm(tokenURL.String(), form)
	if err != nil {
		return oauthAuth{}, fmt.Errorf("failed to refresh OAuth token: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return oauthAuth{}, fmt.Errorf("failed to refresh OAuth token: unexpected status %d", response.StatusCode)
	}

	var token mstlcore.OAuthTokenResponse
	if err := json.NewDecoder(response.Body).Decode(&token); err != nil {
		return oauthAuth{}, fmt.Errorf("failed to decode token response: %w", err)
	}
	return oauthTokenResponseToAuth(token)
}

func tokenURL(baseURL string) (*url.URL, error) {
	parsedURL, err := url.Parse(baseURL)
	if err != nil {
		return nil, fmt.Errorf("failed to parse control plane API URL: %w", err)
	}
	parsedURL.Path = strings.TrimRight(parsedURL.Path, "/") + "/oauth/token"
	return parsedURL, nil
}

func oauthTokenResponseToAuth(response mstlcore.OAuthTokenResponse) (oauthAuth, error) {
	currentSeconds, err := currentUnixSeconds()
	if err != nil {
		return oauthAuth{}, err
	}
	return oauthAuth{
		AccessToken:          response.AccessToken,
		RefreshToken:         response.RefreshToken,
		ExpiresAtUnixSeconds: currentSeconds + response.ExpiresIn,
		Scope:                response.Scope,
	}, nil
}

func currentUnixSeconds() (uint64, error) {
	return uint64(time.Now().Unix()), nil
}

func randomURLSafeToken() (string, error) {
	bytes := make([]byte, 32)
	if _, err := rand.Read(bytes); err != nil {
		return "", fmt.Errorf("failed to generate login token: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(bytes), nil
}

func pkceS256Challenge(codeVerifier string) string {
	digest := sha256.Sum256([]byte(codeVerifier))
	return base64.RawURLEncoding.EncodeToString(digest[:])
}

func openBrowser(rawURL string) error {
	command, err := browserCommand(rawURL)
	if err != nil {
		return err
	}
	if err := command.Run(); err != nil {
		return fmt.Errorf("failed to open browser: %w", err)
	}
	return nil
}

func browserCommand(rawURL string) (*exec.Cmd, error) {
	switch runtime.GOOS {
	case "darwin":
		return exec.Command("open", rawURL), nil
	case "linux":
		return exec.Command("xdg-open", rawURL), nil
	case "windows":
		return exec.Command("cmd", "/C", "start", "", rawURL), nil
	default:
		return nil, fmt.Errorf("failed to open browser: unsupported platform %s", runtime.GOOS)
	}
}
