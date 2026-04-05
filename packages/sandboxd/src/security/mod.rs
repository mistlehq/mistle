use std::fmt;
#[cfg(target_os = "linux")]
use std::os::fd::AsRawFd;
use std::os::unix::net::UnixStream;

#[derive(Debug)]
pub enum SecurityError {
    SetNonDumpable(std::io::Error),
    ReadPeerCredentials(std::io::Error),
    TruncatedPeerCredentials,
    UnexpectedPeerUid { expected_uid: u32, actual_uid: u32 },
}

impl fmt::Display for SecurityError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::SetNonDumpable(error) => {
                write!(f, "failed to set current process non-dumpable: {error}")
            }
            Self::ReadPeerCredentials(error) => {
                write!(f, "failed to read unix socket peer credentials: {error}")
            }
            Self::TruncatedPeerCredentials => {
                write!(f, "unix socket peer credentials were truncated")
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

pub fn apply_current_process_security() -> Result<(), SecurityError> {
    #[cfg(target_os = "linux")]
    {
        // Match the existing sandbox-runtime hardening step before sandboxd starts
        // accepting control connections or launching child processes.
        let result = unsafe { prctl(PR_SET_DUMPABLE, 0, 0, 0, 0) };
        if result != 0 {
            return Err(SecurityError::SetNonDumpable(
                std::io::Error::last_os_error(),
            ));
        }
    }

    Ok(())
}

pub fn ensure_unix_socket_peer_matches_current_process_uid(
    #[cfg(target_os = "linux")] stream: &UnixStream,
    #[cfg(not(target_os = "linux"))] _stream: &UnixStream,
) -> Result<(), SecurityError> {
    #[cfg(target_os = "linux")]
    {
        let fd = stream.as_raw_fd();
        let mut credentials = std::mem::MaybeUninit::<UCred>::zeroed();
        let mut credentials_length = std::mem::size_of::<UCred>() as SockLenT;
        // The control socket is a local root/sandboxd coordination channel. Reject
        // peers from any uid other than the current sandboxd process uid.
        let result = unsafe {
            getsockopt(
                fd,
                SOL_SOCKET,
                SO_PEERCRED,
                credentials.as_mut_ptr().cast(),
                &mut credentials_length,
            )
        };
        if result != 0 {
            return Err(SecurityError::ReadPeerCredentials(
                std::io::Error::last_os_error(),
            ));
        }
        if credentials_length < std::mem::size_of::<UCred>() as SockLenT {
            return Err(SecurityError::TruncatedPeerCredentials);
        }

        let credentials = unsafe { credentials.assume_init() };
        let current_uid = unsafe { geteuid() };
        if credentials.uid != current_uid {
            return Err(SecurityError::UnexpectedPeerUid {
                expected_uid: current_uid,
                actual_uid: credentials.uid,
            });
        }
    }

    Ok(())
}

#[cfg(target_os = "linux")]
#[repr(C)]
struct UCred {
    pid: i32,
    uid: u32,
    gid: u32,
}

#[cfg(target_os = "linux")]
type SockLenT = u32;

#[cfg(target_os = "linux")]
const PR_SET_DUMPABLE: i32 = 4;
#[cfg(target_os = "linux")]
const SOL_SOCKET: i32 = 1;
#[cfg(target_os = "linux")]
const SO_PEERCRED: i32 = 17;

#[cfg(target_os = "linux")]
unsafe extern "C" {
    fn prctl(option: i32, arg2: i32, arg3: i32, arg4: i32, arg5: i32) -> i32;
    fn getsockopt(
        socket: i32,
        level: i32,
        option_name: i32,
        option_value: *mut core::ffi::c_void,
        option_len: *mut SockLenT,
    ) -> i32;
    fn geteuid() -> u32;
}
