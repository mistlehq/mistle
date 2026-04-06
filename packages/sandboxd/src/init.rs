//! Thin local startup submission client for `sandboxd`.
//!
//! `sandboxd init` is the only one-shot command path that remains outside the
//! daemon. It reads one startup payload from stdin, forwards that payload to
//! the running daemon over the local control socket, writes the daemon
//! response to stdout, and exits.

use std::fmt;
use std::io::{Read, Write};
use std::path::Path;

use crate::control;
use crate::protocol::startup::{StartupInitErrorResponse, StartupInitOkResponse, StartupInput};

/// Describes why `sandboxd init` failed to read stdin, submit to the daemon, or
/// write its JSON response.
#[derive(Debug)]
pub enum InitError {
    ReadRequest(std::io::Error),
    InvalidRequest(serde_json::Error),
    SubmitInit(String),
    WriteResponse(std::io::Error),
    SerializeResponse(serde_json::Error),
}

impl fmt::Display for InitError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::ReadRequest(error) => write!(f, "failed to read sandbox init request: {error}"),
            Self::InvalidRequest(error) => {
                write!(f, "sandbox init request must be valid json: {error}")
            }
            Self::SubmitInit(error) => write!(f, "failed to submit sandbox init request: {error}"),
            Self::WriteResponse(error) => {
                write!(f, "failed to write sandbox init response: {error}")
            }
            Self::SerializeResponse(error) => {
                write!(f, "failed to serialize sandbox init response: {error}")
            }
        }
    }
}

impl std::error::Error for InitError {}

/// Reads one startup payload from stdin, submits it to the daemon, and writes
/// a JSON response.
pub fn run_init<R, W>(
    reader: &mut R,
    writer: &mut W,
    control_socket_path: &Path,
) -> Result<(), InitError>
where
    R: Read,
    W: Write,
{
    let mut raw_request = Vec::new();
    let startup_input = match reader.read_to_end(&mut raw_request) {
        Ok(_) => match serde_json::from_slice::<StartupInput>(&raw_request) {
            Ok(startup_input) => startup_input,
            Err(error) => {
                let error = InitError::InvalidRequest(error);
                write_response(
                    writer,
                    &StartupInitErrorResponse {
                        ok: false,
                        error: error.to_string(),
                    },
                )?;
                return Err(error);
            }
        },
        Err(error) => {
            let error = InitError::ReadRequest(error);
            write_response(
                writer,
                &StartupInitErrorResponse {
                    ok: false,
                    error: error.to_string(),
                },
            )?;
            return Err(error);
        }
    };

    match control::submit_init(control_socket_path, &startup_input) {
        Ok(()) => {
            write_response(writer, &StartupInitOkResponse { ok: true })?;
            Ok(())
        }
        Err(error) => {
            let error = InitError::SubmitInit(error.to_string());
            write_response(
                writer,
                &StartupInitErrorResponse {
                    ok: false,
                    error: error.to_string(),
                },
            )?;
            Err(error)
        }
    }
}

fn write_response<W, T>(writer: &mut W, response: &T) -> Result<(), InitError>
where
    W: Write,
    T: serde::Serialize,
{
    let response_bytes = serde_json::to_vec(response).map_err(InitError::SerializeResponse)?;
    writer
        .write_all(&response_bytes)
        .map_err(InitError::WriteResponse)?;
    writer.write_all(b"\n").map_err(InitError::WriteResponse)?;
    writer.flush().map_err(InitError::WriteResponse)
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};

    use crate::control;
    use crate::protocol::startup::{StartupInitResponse, StartupMode};
    use crate::time::ThreadSleeper;

    use crate::init::run_init;

    static TEMP_DIR_COUNTER: AtomicU64 = AtomicU64::new(0);

    #[test]
    fn submits_startup_input_and_writes_ok_response() {
        let request =
            include_str!("../../sandbox-runtime-contract/tests/fixtures/startup-input.valid.json");
        let test_dir = create_temp_test_dir("init_ok");
        let control_socket_path = test_dir.join("control.sock");
        let mut stdout = Vec::new();
        let server = control::start_control_server(
            &control_socket_path,
            ThreadSleeper,
            control::DEFAULT_CONTROL_ACCEPT_POLL_INTERVAL,
        )
        .expect("control server should start");

        run_init(&mut request.as_bytes(), &mut stdout, &control_socket_path)
            .expect("init should submit a valid startup input");

        let response: StartupInitResponse =
            serde_json::from_slice(&stdout).expect("init should write a valid response");

        assert_eq!(
            response,
            StartupInitResponse::Ok(crate::protocol::startup::StartupInitOkResponse { ok: true })
        );
        assert_eq!(
            server
                .startup_input()
                .expect("server should store startup input")
                .startup_mode,
            StartupMode::New
        );

        server.close().expect("control server should stop cleanly");
        fs::remove_dir_all(test_dir).expect("temp test dir should be removable");
    }

    #[test]
    fn writes_error_response_for_invalid_startup_input() {
        let test_dir = create_temp_test_dir("init_invalid");
        let control_socket_path = test_dir.join("control.sock");
        let mut stdout = Vec::new();

        let error = run_init(
            &mut br#"{"startupMode":null}"#.as_slice(),
            &mut stdout,
            &control_socket_path,
        )
        .expect_err("invalid init request should fail");

        let response: StartupInitResponse =
            serde_json::from_slice(&stdout).expect("init should write an error response");
        assert!(matches!(error, crate::init::InitError::InvalidRequest(_)));
        assert!(matches!(response, StartupInitResponse::Error(_)));

        fs::remove_dir_all(test_dir).expect("temp test dir should be removable");
    }

    fn create_temp_test_dir(prefix: &str) -> std::path::PathBuf {
        let counter = TEMP_DIR_COUNTER.fetch_add(1, Ordering::Relaxed);
        let unique_suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be after unix epoch")
            .as_nanos();
        let path = std::path::Path::new("/tmp").join(format!(
            "sbd_{prefix}_{}_{}_{}",
            std::process::id(),
            counter,
            unique_suffix
        ));

        fs::create_dir_all(&path).expect("temp test dir should be creatable");

        path
    }
}
