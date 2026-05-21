use std::fmt;
use std::net::SocketAddr;
use std::path::PathBuf;

/// Describes why the local control socket server or client path failed.
#[derive(Debug)]
pub enum ControlError {
    MissingSocketParent {
        path: PathBuf,
    },
    CreateSocketDirectory {
        path: PathBuf,
        error: std::io::Error,
    },
    ReadSocketMetadata {
        path: PathBuf,
        error: std::io::Error,
    },
    ExistingSocketPathIsNotSocket {
        path: PathBuf,
    },
    RemoveStaleSocket {
        path: PathBuf,
        error: std::io::Error,
    },
    BindSocket {
        path: PathBuf,
        error: std::io::Error,
    },
    BindHealthEndpoint {
        address: SocketAddr,
        error: std::io::Error,
    },
    AcceptConnection(std::io::Error),
    AcceptHealthConnection(std::io::Error),
    ConfigureConnection(std::io::Error),
    ReadRequest(std::io::Error),
    ReadHealthRequest(std::io::Error),
    InvalidRequest(serde_json::Error),
    InvalidResponse(serde_json::Error),
    VerifyPeer(String),
    StartupRequestRejected(String),
    InitializeSandboxdState(String),
    ResumeSandboxdState(String),
    CloseSandboxdState(String),
    SerializeResponse(serde_json::Error),
    WriteResponse(std::io::Error),
    WriteHealthResponse(std::io::Error),
    ResponseError(String),
    ConnectSocket {
        path: PathBuf,
        error: std::io::Error,
    },
    ShutdownSend,
    ServerPanicked,
    HealthServerPanicked,
    InitPanicked,
}

impl fmt::Display for ControlError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::MissingSocketParent { path } => {
                write!(
                    f,
                    "control socket path {} has no parent directory",
                    path.display()
                )
            }
            Self::CreateSocketDirectory { path, error } => write!(
                f,
                "failed to create control socket directory {}: {error}",
                path.display()
            ),
            Self::ReadSocketMetadata { path, error } => write!(
                f,
                "failed to inspect control socket path {}: {error}",
                path.display()
            ),
            Self::ExistingSocketPathIsNotSocket { path } => write!(
                f,
                "control socket path {} already exists and is not a unix socket",
                path.display()
            ),
            Self::RemoveStaleSocket { path, error } => {
                write!(
                    f,
                    "failed to remove stale control socket {}: {error}",
                    path.display()
                )
            }
            Self::BindSocket { path, error } => {
                write!(
                    f,
                    "failed to bind control socket {}: {error}",
                    path.display()
                )
            }
            Self::BindHealthEndpoint { address, error } => {
                write!(f, "failed to bind health endpoint {address}: {error}")
            }
            Self::AcceptConnection(error) => {
                write!(f, "failed to accept control socket connection: {error}")
            }
            Self::AcceptHealthConnection(error) => {
                write!(f, "failed to accept health endpoint connection: {error}")
            }
            Self::ConfigureConnection(error) => {
                write!(f, "failed to configure control socket connection: {error}")
            }
            Self::ReadRequest(error) => write!(f, "failed to read control socket request: {error}"),
            Self::ReadHealthRequest(error) => {
                write!(f, "failed to read health endpoint request: {error}")
            }
            Self::InvalidRequest(error) => {
                write!(f, "control socket request must be valid json: {error}")
            }
            Self::InvalidResponse(error) => {
                write!(f, "control socket response must be valid json: {error}")
            }
            Self::VerifyPeer(error) => {
                write!(f, "control socket peer verification failed: {error}")
            }
            Self::StartupRequestRejected(error) => {
                write!(f, "sandbox startup request was rejected: {error}")
            }
            Self::InitializeSandboxdState(error) => {
                write!(f, "failed to initialize sandboxd state: {error}")
            }
            Self::ResumeSandboxdState(error) => {
                write!(f, "failed to resume sandboxd state: {error}")
            }
            Self::CloseSandboxdState(error) => {
                write!(f, "failed to close sandboxd state: {error}")
            }
            Self::SerializeResponse(error) => {
                write!(f, "failed to serialize control socket response: {error}")
            }
            Self::WriteResponse(error) => {
                write!(f, "failed to write control socket response: {error}")
            }
            Self::WriteHealthResponse(error) => {
                write!(f, "failed to write health endpoint response: {error}")
            }
            Self::ResponseError(error) => write!(f, "control socket returned an error: {error}"),
            Self::ConnectSocket { path, error } => {
                write!(
                    f,
                    "failed to connect to control socket {}: {error}",
                    path.display()
                )
            }
            Self::ShutdownSend => write!(f, "failed to signal control socket shutdown"),
            Self::ServerPanicked => write!(f, "control socket server panicked"),
            Self::HealthServerPanicked => write!(f, "health endpoint server panicked"),
            Self::InitPanicked => write!(f, "sandbox init worker panicked"),
        }
    }
}

impl std::error::Error for ControlError {}
