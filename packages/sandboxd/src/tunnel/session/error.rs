//! Error types exposed by the live tunnel session facade.

use std::fmt::{self, Display};

/// Describes why the live bootstrap tunnel session could not start or stop.
#[derive(Debug)]
pub enum TunnelSessionError {
    InvalidGatewayUrl(String),
    ConfigureTunnelSocket(String),
    AttachmentRoot(String),
    AttachTelemetry(String),
    HandleTelemetry(String),
    PublishKeepalive(serde_json::Error),
    PublishRuntimeReady(serde_json::Error),
    MissingRuntimeReadyState(String),
    WriteTunnelText(String),
    WriteTunnelBinary(String),
    ReadTunnel(String),
    ParseControl(String),
    ParseDataFrame(String),
    Signing(String),
    EgressToken(String),
    AgentDial(String),
    AgentSocket(String),
    AgentRead(String),
    AgentWrite(String),
    Egress(String),
    PortAccess(String),
    Processes(String),
    Pty(String),
    FileUpload(String),
    SessionPanicked,
}

impl Display for TunnelSessionError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidGatewayUrl(error) => {
                write!(
                    f,
                    "failed to derive sandbox instance id from tunnel url: {error}"
                )
            }
            Self::ConfigureTunnelSocket(error) => {
                write!(f, "failed to configure bootstrap tunnel socket: {error}")
            }
            Self::AttachmentRoot(error) => write!(f, "failed to prepare attachment root: {error}"),
            Self::AttachTelemetry(error) => {
                write!(f, "failed to attach telemetry relay: {error}")
            }
            Self::HandleTelemetry(error) => {
                write!(f, "failed to handle bootstrap telemetry control: {error}")
            }
            Self::PublishKeepalive(error) => {
                write!(f, "failed to serialize keepalive payload: {error}")
            }
            Self::PublishRuntimeReady(error) => {
                write!(f, "failed to serialize runtime readiness payload: {error}")
            }
            Self::MissingRuntimeReadyState(error) => {
                write!(f, "failed to prepare runtime readiness payload: {error}")
            }
            Self::WriteTunnelText(error) => {
                write!(f, "failed to write bootstrap tunnel text frame: {error}")
            }
            Self::WriteTunnelBinary(error) => {
                write!(f, "failed to write bootstrap tunnel binary frame: {error}")
            }
            Self::ReadTunnel(error) => write!(f, "failed to read bootstrap tunnel frame: {error}"),
            Self::ParseControl(error) => {
                write!(f, "invalid bootstrap tunnel control frame: {error}")
            }
            Self::ParseDataFrame(error) => {
                write!(f, "invalid bootstrap tunnel data frame: {error}")
            }
            Self::Signing(error) => write!(f, "failed to handle signing request: {error}"),
            Self::EgressToken(error) => {
                write!(f, "failed to handle egress token request: {error}")
            }
            Self::AgentDial(error) => {
                write!(f, "failed to connect agent runtime endpoint: {error}")
            }
            Self::AgentSocket(error) => {
                write!(f, "failed to configure agent runtime socket: {error}")
            }
            Self::AgentRead(error) => write!(f, "failed to read agent runtime socket: {error}"),
            Self::AgentWrite(error) => write!(f, "failed to write agent runtime socket: {error}"),
            Self::Egress(error) => write!(f, "failed to service gateway egress request: {error}"),
            Self::PortAccess(error) => {
                write!(f, "failed to handle port access control message: {error}")
            }
            Self::Processes(error) => {
                write!(f, "failed to service processes tunnel stream: {error}")
            }
            Self::Pty(error) => write!(f, "failed to handle PTY tunnel stream: {error}"),
            Self::FileUpload(error) => write!(f, "failed to handle file upload stream: {error}"),
            Self::SessionPanicked => write!(f, "bootstrap tunnel session thread panicked"),
        }
    }
}

impl std::error::Error for TunnelSessionError {}
