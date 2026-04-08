use std::ffi::OsString;
use std::sync::{LazyLock, Mutex, MutexGuard};

static ENV_MUTEX: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));

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
