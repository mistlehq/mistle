use std::ffi::OsString;
use std::fs;
use std::path::PathBuf;
use std::sync::{LazyLock, Mutex, MutexGuard};

use serde::Deserialize;

static ENV_MUTEX: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));
static ATTACHMENT_ROOT_OVERRIDE: LazyLock<Mutex<Option<PathBuf>>> =
    LazyLock::new(|| Mutex::new(None));
static LOCAL_SANDBOX_BASE_IMAGE_REFS: LazyLock<LocalSandboxBaseImageRefs> = LazyLock::new(|| {
    let manifest_path = sandbox_base_images_manifest_path();
    let manifest_contents = fs::read_to_string(&manifest_path).unwrap_or_else(|error| {
        panic!(
            "sandbox base images manifest should be readable at {}: {error}",
            manifest_path.display()
        )
    });

    serde_json::from_str(&manifest_contents)
        .expect("sandbox base images manifest should be valid JSON")
});

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LocalSandboxBaseImageRefs {
    local_dev: LocalDevSandboxBaseImageRefs,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LocalDevSandboxBaseImageRefs {
    prepared_runtime: String,
}

fn sandbox_base_images_manifest_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("config")
        .join("sandbox-base-images.json")
}

pub struct TestEnvVarGuard {
    _lock: MutexGuard<'static, ()>,
    name: &'static str,
    previous: Option<OsString>,
}

pub struct TestEnvVarsGuard {
    _lock: MutexGuard<'static, ()>,
    previous: Vec<(&'static str, Option<OsString>)>,
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

impl TestEnvVarsGuard {
    pub fn set<const N: usize>(entries: [(&'static str, String); N]) -> Self {
        let lock = ENV_MUTEX
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let mut previous = Vec::with_capacity(N);

        for (name, value) in entries {
            previous.push((name, std::env::var_os(name)));
            // SAFETY: tests serialize environment mutation through ENV_MUTEX.
            unsafe {
                std::env::set_var(name, value);
            }
        }

        Self {
            _lock: lock,
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

impl Drop for TestEnvVarsGuard {
    fn drop(&mut self) {
        for (name, previous) in self.previous.iter().rev() {
            match previous {
                Some(previous) => {
                    // SAFETY: tests serialize environment mutation through ENV_MUTEX.
                    unsafe {
                        std::env::set_var(name, previous);
                    }
                }
                None => {
                    // SAFETY: tests serialize environment mutation through ENV_MUTEX.
                    unsafe {
                        std::env::remove_var(name);
                    }
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

pub fn local_prepared_runtime_sandbox_base_image_ref() -> &'static str {
    LOCAL_SANDBOX_BASE_IMAGE_REFS
        .local_dev
        .prepared_runtime
        .as_str()
}
