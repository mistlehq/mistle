//! Linux-specific process and Unix-socket hardening for `sandboxd`.
//!
//! This module owns the supervisor-side hardening that must happen before
//! `sandboxd` starts accepting local control connections or launching managed
//! child processes.

use std::fmt;
use std::os::unix::net::UnixStream;

#[cfg(target_os = "linux")]
use nix::sys::prctl;
#[cfg(target_os = "linux")]
use nix::sys::socket::{getsockopt, sockopt};
#[cfg(target_os = "linux")]
use nix::unistd::geteuid;

/// Describes why one Linux-specific hardening step failed.
#[derive(Debug)]
pub enum SecurityError {
    UnsupportedPlatform,
    SetNonDumpable(nix::errno::Errno),
    ReadPeerCredentials(nix::errno::Errno),
    UnexpectedPeerUid { expected_uid: u32, actual_uid: u32 },
}

impl fmt::Display for SecurityError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::UnsupportedPlatform => write!(
                f,
                "sandboxd security hardening is only supported in linux sandboxes"
            ),
            Self::SetNonDumpable(error) => {
                write!(f, "failed to set current process non-dumpable: {error}")
            }
            Self::ReadPeerCredentials(error) => {
                write!(f, "failed to read unix socket peer credentials: {error}")
            }
            Self::UnexpectedPeerUid {
                expected_uid,
                actual_uid,
            } => write!(
                f,
                "control socket connection must come from uid {expected_uid}, got uid {actual_uid}"
            ),
        }
    }
}

impl std::error::Error for SecurityError {}

/// Applies supervisor hardening to the current `sandboxd` process.
pub fn apply_current_process_security() -> Result<(), SecurityError> {
    #[cfg(target_os = "linux")]
    {
        // Prevent same-uid debuggers and procfs readers from inspecting this
        // supervisor or its managed child processes through dumpable state.
        prctl::set_dumpable(false).map_err(SecurityError::SetNonDumpable)
    }

    #[cfg(all(not(target_os = "linux"), test))]
    {
        Ok(())
    }

    #[cfg(all(not(target_os = "linux"), not(test)))]
    {
        Err(SecurityError::UnsupportedPlatform)
    }
}

/// Rejects Unix socket peers whose effective uid does not match the current supervisor process.
pub fn ensure_unix_socket_peer_matches_current_process_uid(
    #[cfg(target_os = "linux")] stream: &UnixStream,
    #[cfg(not(target_os = "linux"))] _stream: &UnixStream,
) -> Result<(), SecurityError> {
    #[cfg(target_os = "linux")]
    {
        // The control socket is a local root/sandboxd coordination channel. Reject
        // peers from any uid other than the current sandboxd process uid.
        let credentials = getsockopt(stream, sockopt::PeerCredentials)
            .map_err(SecurityError::ReadPeerCredentials)?;
        let current_uid = geteuid().as_raw();
        if credentials.uid() != current_uid {
            return Err(SecurityError::UnexpectedPeerUid {
                expected_uid: current_uid,
                actual_uid: credentials.uid(),
            });
        }

        Ok(())
    }

    #[cfg(all(not(target_os = "linux"), test))]
    {
        Ok(())
    }

    #[cfg(all(not(target_os = "linux"), not(test)))]
    {
        Err(SecurityError::UnsupportedPlatform)
    }
}
