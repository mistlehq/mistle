use std::ffi::OsString;
use std::path::PathBuf;
use std::sync::{LazyLock, Mutex, MutexGuard};

static ENV_MUTEX: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));
static ATTACHMENT_ROOT_OVERRIDE: LazyLock<Mutex<Option<PathBuf>>> =
    LazyLock::new(|| Mutex::new(None));

pub struct TestEnvVarGuard {
    _lock: MutexGuard<'static, ()>,
    name: &'static str,
    previous: Option<OsString>,
}

impl TestEnvVarGuard {
    pub fn set(name: &'static str, value: &str) -> Self {
        let lock = ENV_MUTEX
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let previous = std::env::var_os(name);
        // SAFETY: tests serialize environment mutation through ENV_MUTEX.
        unsafe {
            std::env::set_var(name, value);
        }
        Self {
            _lock: lock,
            name,
            previous,
        }
    }

    pub fn unset(name: &'static str) -> Self {
        let lock = ENV_MUTEX
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let previous = std::env::var_os(name);
        // SAFETY: tests serialize environment mutation through ENV_MUTEX.
        unsafe {
            std::env::remove_var(name);
        }
        Self {
            _lock: lock,
            name,
            previous,
        }
    }
}

impl Drop for TestEnvVarGuard {
    fn drop(&mut self) {
        match &self.previous {
            Some(previous) => {
                // SAFETY: tests serialize environment mutation through ENV_MUTEX.
                unsafe {
                    std::env::set_var(self.name, previous);
                }
            }
            None => {
                // SAFETY: tests serialize environment mutation through ENV_MUTEX.
                unsafe {
                    std::env::remove_var(self.name);
                }
            }
        }
    }
}

pub struct TestAttachmentRootGuard {
    previous: Option<PathBuf>,
}

impl TestAttachmentRootGuard {
    pub fn set(path: PathBuf) -> Self {
        let mut override_slot = ATTACHMENT_ROOT_OVERRIDE
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let previous = override_slot.replace(path);
        Self { previous }
    }
}

impl Drop for TestAttachmentRootGuard {
    fn drop(&mut self) {
        let mut override_slot = ATTACHMENT_ROOT_OVERRIDE
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        *override_slot = self.previous.take();
    }
}

pub fn attachment_root_override() -> Option<PathBuf> {
    ATTACHMENT_ROOT_OVERRIDE
        .lock()
        .unwrap_or_else(|poison| poison.into_inner())
        .clone()
}
