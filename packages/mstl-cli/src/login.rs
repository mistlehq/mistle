use std::error::Error;
use std::fmt::{Display, Formatter};
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use mstl_core::client::OAuthTokenResponse;
use sha2::{Digest, Sha256};
use url::Url;

use crate::auth_file;
use crate::config::control_plane_api_public_url;
use crate::error::CliError;

const CLI_CLIENT_ID: &str = "mistle-cli";
const CALLBACK_HOST: &str = "127.0.0.1";
const CALLBACK_PATH: &str = "/callback";

pub(crate) fn run_login<W, E>(stdout: &mut W, stderr: &mut E) -> i32
where
    W: Write,
    E: Write,
{
    match login(stdout) {
        Ok(()) => 0,
        Err(error) => {
            let _ = writeln!(stderr, "{error}");
            1
        }
    }
}

pub(crate) fn run_logout<W, E>(stdout: &mut W, stderr: &mut E) -> i32
where
    W: Write,
    E: Write,
{
    match auth_file::remove_auth_file() {
        Ok(Some(path)) => {
            match writeln!(stdout, "Removed local Mistle auth file: {}", path.display()) {
                Ok(()) => 0,
                Err(error) => {
                    let _ = writeln!(stderr, "failed to write logout result: {error}");
                    1
                }
            }
        }
        Ok(None) => match writeln!(stdout, "No local Mistle auth file found") {
            Ok(()) => 0,
            Err(error) => {
                let _ = writeln!(stderr, "failed to write logout result: {error}");
                1
            }
        },
        Err(error) => {
            let _ = writeln!(stderr, "{error}");
            1
        }
    }
}

fn login<W>(stdout: &mut W) -> Result<(), CliError>
where
    W: Write,
{
    let base_url = control_plane_api_public_url()?;
    let listener = TcpListener::bind((CALLBACK_HOST, 0))
        .map_err(|source| login_error("bind local callback server", source))?;
    let callback_port = listener
        .local_addr()
        .map_err(|source| login_error("read local callback address", source))?
        .port();
    let redirect_uri = format!("http://{CALLBACK_HOST}:{callback_port}{CALLBACK_PATH}");
    let state = random_url_safe_token()?;
    let code_verifier = random_url_safe_token()?;
    let code_challenge = pkce_s256_challenge(&code_verifier);
    let authorization_url = build_authorization_url(AuthorizationUrlInput {
        base_url: &base_url,
        redirect_uri: &redirect_uri,
        resource: &base_url,
        state: &state,
        code_challenge: &code_challenge,
    })?;

    writeln!(stdout, "Opening browser for Mistle login...")
        .map_err(|source| login_error("write login status", source))?;
    open_browser(authorization_url.as_str())?;

    let callback = wait_for_callback(&listener, &state)?;
    let token = exchange_authorization_code(TokenExchangeInput {
        base_url: &base_url,
        code: &callback.code,
        redirect_uri: &redirect_uri,
        resource: &base_url,
        code_verifier: &code_verifier,
    })?;
    let auth_file_path = auth_file::write_oauth(oauth_token_response_to_auth(token)?)?;

    writeln!(stdout, "Logged in to Mistle")
        .and_then(|()| writeln!(stdout, "Wrote auth file: {}", auth_file_path.display()))
        .map_err(|source| login_error("write login result", source))
}

struct AuthorizationUrlInput<'a> {
    base_url: &'a str,
    redirect_uri: &'a str,
    resource: &'a str,
    state: &'a str,
    code_challenge: &'a str,
}

fn build_authorization_url(input: AuthorizationUrlInput<'_>) -> Result<Url, CliError> {
    let mut url = Url::parse(input.base_url)
        .map_err(|source| login_error("parse control plane API URL", source))?;
    url.set_path(&format!(
        "{}/oauth/authorize",
        url.path().trim_end_matches('/')
    ));
    url.query_pairs_mut()
        .append_pair("response_type", "code")
        .append_pair("client_id", CLI_CLIENT_ID)
        .append_pair("redirect_uri", input.redirect_uri)
        .append_pair("resource", input.resource)
        .append_pair("state", input.state)
        .append_pair("code_challenge", input.code_challenge)
        .append_pair("code_challenge_method", "S256");

    Ok(url)
}

fn wait_for_callback(
    listener: &TcpListener,
    expected_state: &str,
) -> Result<LoginCallback, CliError> {
    let (mut stream, _) = listener
        .accept()
        .map_err(|source| login_error("accept local login callback", source))?;
    let callback = read_callback(&mut stream, expected_state);
    let response = match callback {
        Ok(_) => CallbackHttpResponse::success(),
        Err(_) => CallbackHttpResponse::failure(),
    };
    write_callback_response(&mut stream, response)?;
    callback
}

fn read_callback(stream: &mut TcpStream, expected_state: &str) -> Result<LoginCallback, CliError> {
    let request = read_http_request(stream)?;
    let request_line = request
        .lines()
        .next()
        .ok_or_else(|| login_message("read local login callback", "callback request was empty"))?;
    let mut request_parts = request_line.split_whitespace();
    let method = request_parts.next().ok_or_else(|| {
        login_message(
            "read local login callback",
            "callback request method is missing",
        )
    })?;
    let path = request_parts.next().ok_or_else(|| {
        login_message(
            "read local login callback",
            "callback request path is missing",
        )
    })?;

    if method != "GET" {
        return Err(login_message(
            "read local login callback",
            "callback request must use GET",
        ));
    }

    let url = Url::parse(&format!("http://{CALLBACK_HOST}{path}"))
        .map_err(|source| login_error("parse local login callback", source))?;
    if url.path() != CALLBACK_PATH {
        return Err(login_message(
            "read local login callback",
            "callback path is invalid",
        ));
    }

    let code = query_parameter(&url, "code")?;
    let state = query_parameter(&url, "state")?;
    if state != expected_state {
        return Err(login_message(
            "read local login callback",
            "callback state is invalid",
        ));
    }

    Ok(LoginCallback { code })
}

fn read_http_request(stream: &mut TcpStream) -> Result<String, CliError> {
    let mut buffer = Vec::new();
    let mut chunk = [0_u8; 1024];

    loop {
        let read = stream
            .read(&mut chunk)
            .map_err(|source| login_error("read local login callback", source))?;
        if read == 0 {
            break;
        }
        buffer.extend_from_slice(&chunk[..read]);
        if buffer.windows(4).any(|window| window == b"\r\n\r\n") {
            break;
        }
    }

    String::from_utf8(buffer).map_err(|source| login_error("decode local login callback", source))
}

fn query_parameter(url: &Url, name: &str) -> Result<String, CliError> {
    url.query_pairs()
        .find(|(key, _)| key == name)
        .map(|(_, value)| value.into_owned())
        .ok_or_else(|| {
            login_message(
                "read local login callback",
                "callback is missing required query parameter",
            )
        })
}

struct LoginCallback {
    code: String,
}

struct CallbackHttpResponse {
    status: &'static str,
    body: &'static str,
}

impl CallbackHttpResponse {
    fn success() -> Self {
        Self {
            status: "200 OK",
            body: "Mistle login complete. You can close this window.",
        }
    }

    fn failure() -> Self {
        Self {
            status: "400 Bad Request",
            body: "Mistle login failed. Return to your terminal for details.",
        }
    }
}

fn write_callback_response(
    stream: &mut TcpStream,
    response: CallbackHttpResponse,
) -> Result<(), CliError> {
    let body = response.body;
    let response = format!(
        "HTTP/1.1 {}\r\ncontent-type: text/plain; charset=utf-8\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{}",
        response.status,
        body.len(),
        body
    );
    stream
        .write_all(response.as_bytes())
        .map_err(|source| login_error("write local login callback response", source))
}

struct TokenExchangeInput<'a> {
    base_url: &'a str,
    code: &'a str,
    redirect_uri: &'a str,
    resource: &'a str,
    code_verifier: &'a str,
}

fn exchange_authorization_code(
    input: TokenExchangeInput<'_>,
) -> Result<OAuthTokenResponse, CliError> {
    let token_url = token_url(input.base_url)?;
    let mut response = ureq::post(token_url.as_str())
        .send_form([
            ("grant_type", "authorization_code"),
            ("client_id", CLI_CLIENT_ID),
            ("redirect_uri", input.redirect_uri),
            ("resource", input.resource),
            ("code", input.code),
            ("code_verifier", input.code_verifier),
        ])
        .map_err(|source| login_error("exchange authorization code", source))?;
    let response_body = response
        .body_mut()
        .read_to_string()
        .map_err(|source| login_error("read token response", source))?;

    serde_json::from_str(&response_body)
        .map_err(|source| login_error("decode token response", source))
}

pub(crate) fn refresh_oauth_auth(
    base_url: &str,
    refresh_token: &str,
) -> Result<auth_file::OAuthAuth, CliError> {
    let token_url = token_url(base_url)?;
    let mut response = ureq::post(token_url.as_str())
        .send_form([
            ("grant_type", "refresh_token"),
            ("client_id", CLI_CLIENT_ID),
            ("resource", base_url),
            ("refresh_token", refresh_token),
        ])
        .map_err(|source| login_error("refresh OAuth token", source))?;
    let response_body = response
        .body_mut()
        .read_to_string()
        .map_err(|source| login_error("read token response", source))?;

    let token = serde_json::from_str::<OAuthTokenResponse>(&response_body)
        .map_err(|source| login_error("decode token response", source))?;
    oauth_token_response_to_auth(token)
}

fn token_url(base_url: &str) -> Result<Url, CliError> {
    let mut url = Url::parse(base_url)
        .map_err(|source| login_error("parse control plane API URL", source))?;
    url.set_path(&format!("{}/oauth/token", url.path().trim_end_matches('/')));
    Ok(url)
}

pub(crate) fn oauth_token_response_to_auth(
    response: OAuthTokenResponse,
) -> Result<auth_file::OAuthAuth, CliError> {
    Ok(auth_file::OAuthAuth {
        access_token: response.access_token,
        refresh_token: response.refresh_token,
        expires_at_unix_seconds: current_unix_seconds()? + response.expires_in,
        scope: response.scope,
    })
}

pub(crate) fn current_unix_seconds() -> Result<u64, CliError> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .map_err(|source| login_error("read system time", source))
}

fn random_url_safe_token() -> Result<String, CliError> {
    let mut bytes = [0_u8; 32];
    getrandom::fill(&mut bytes).map_err(|source| login_error("generate login token", source))?;
    Ok(URL_SAFE_NO_PAD.encode(bytes))
}

fn pkce_s256_challenge(code_verifier: &str) -> String {
    let digest = Sha256::digest(code_verifier.as_bytes());
    URL_SAFE_NO_PAD.encode(digest)
}

fn open_browser(url: &str) -> Result<(), CliError> {
    let status = browser_command(url)
        .status()
        .map_err(|source| login_error("open browser", source))?;
    if !status.success() {
        return Err(login_message(
            "open browser",
            "browser command exited unsuccessfully",
        ));
    }

    Ok(())
}

#[cfg(target_os = "macos")]
fn browser_command(url: &str) -> Command {
    let mut command = Command::new("open");
    command.arg(url);
    command
}

#[cfg(target_os = "linux")]
fn browser_command(url: &str) -> Command {
    let mut command = Command::new("xdg-open");
    command.arg(url);
    command
}

#[cfg(target_os = "windows")]
fn browser_command(url: &str) -> Command {
    let mut command = Command::new("cmd");
    command.args(["/C", "start", "", url]);
    command
}

#[derive(Debug)]
struct LoginErrorMessage(String);

impl Display for LoginErrorMessage {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl Error for LoginErrorMessage {}

fn login_error<E>(action: &'static str, source: E) -> CliError
where
    E: Error + Send + Sync + 'static,
{
    CliError::Login {
        action,
        source: Box::new(source),
    }
}

fn login_message(action: &'static str, message: &'static str) -> CliError {
    CliError::Login {
        action,
        source: Box::new(LoginErrorMessage(message.to_owned())),
    }
}

#[cfg(test)]
mod tests {
    use crate::login::{AuthorizationUrlInput, build_authorization_url, pkce_s256_challenge};

    #[test]
    fn builds_authorization_url_with_loopback_redirect_and_pkce() {
        let url = build_authorization_url(AuthorizationUrlInput {
            base_url: "http://127.0.0.1:5100",
            redirect_uri: "http://127.0.0.1:61234/callback",
            resource: "http://127.0.0.1:5100",
            state: "state-token",
            code_challenge: "challenge-token",
        })
        .expect("authorization url should build");

        assert_eq!(
            url.as_str(),
            "http://127.0.0.1:5100/oauth/authorize?response_type=code&client_id=mistle-cli&redirect_uri=http%3A%2F%2F127.0.0.1%3A61234%2Fcallback&resource=http%3A%2F%2F127.0.0.1%3A5100&state=state-token&code_challenge=challenge-token&code_challenge_method=S256"
        );
    }

    #[test]
    fn computes_pkce_s256_challenge() {
        assert_eq!(
            pkce_s256_challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
    }
}
