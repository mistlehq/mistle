package cli

import "testing"

func TestBuildAuthorizationURLWithLoopbackRedirectAndPKCE(t *testing.T) {
	authorizationURL, err := buildAuthorizationURL(authorizationURLInput{
		BaseURL:       "http://127.0.0.1:5100",
		RedirectURI:   "http://127.0.0.1:61234/callback",
		Resource:      "http://127.0.0.1:5100",
		State:         "state-token",
		CodeChallenge: "challenge-token",
	})
	requireNoError(t, err)

	assertEqual(
		t,
		authorizationURL.String(),
		"http://127.0.0.1:5100/oauth/authorize?client_id=mistle-cli&code_challenge=challenge-token&code_challenge_method=S256&redirect_uri=http%3A%2F%2F127.0.0.1%3A61234%2Fcallback&resource=http%3A%2F%2F127.0.0.1%3A5100&response_type=code&state=state-token",
	)
}

func TestPKCES256Challenge(t *testing.T) {
	assertEqual(
		t,
		pkceS256Challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
		"E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
	)
}

func TestWriteOAuthWritesAuthFile(t *testing.T) {
	configHome := isolatedConfigHome(t)
	t.Setenv("XDG_CONFIG_HOME", configHome)

	path, err := writeOAuth(oauthAuth{
		AccessToken:          "mstl_oat_access",
		RefreshToken:         "mstl_ort_refresh",
		ExpiresAtUnixSeconds: 9999999999,
		Scope:                "organization:read",
	})
	requireNoError(t, err)

	credential, err := readAuthCredentialFromPath(path)
	requireNoError(t, err)
	if credential.OAuth == nil {
		t.Fatalf("expected OAuth credential")
	}
	assertEqual(t, credential.OAuth.AccessToken, "mstl_oat_access")
}
