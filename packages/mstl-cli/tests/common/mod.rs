use std::time::{SystemTime, UNIX_EPOCH};

pub fn isolated_config_home(test_name: &str) -> String {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time should be after unix epoch")
        .as_nanos();

    std::env::temp_dir()
        .join(format!(
            "mistle-cli-{test_name}-{}-{timestamp}",
            std::process::id()
        ))
        .to_string_lossy()
        .into_owned()
}
