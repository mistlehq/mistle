pub const API_KEY_ENV_VAR: &str = "MISTLE_API_KEY";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AuthStatus {
    Authenticated,
    Unauthenticated,
}

pub fn api_key_auth_status(api_key: Option<&str>) -> AuthStatus {
    match api_key {
        Some(value) if !value.trim().is_empty() => AuthStatus::Authenticated,
        _ => AuthStatus::Unauthenticated,
    }
}

#[cfg(test)]
mod tests {
    use crate::auth::{AuthStatus, api_key_auth_status};

    #[test]
    fn reports_authenticated_when_api_key_has_content() {
        assert_eq!(
            api_key_auth_status(Some("mstl_test_key")),
            AuthStatus::Authenticated
        );
    }

    #[test]
    fn reports_unauthenticated_when_api_key_is_absent() {
        assert_eq!(api_key_auth_status(None), AuthStatus::Unauthenticated);
    }

    #[test]
    fn reports_unauthenticated_when_api_key_is_blank() {
        assert_eq!(api_key_auth_status(Some("")), AuthStatus::Unauthenticated);
        assert_eq!(api_key_auth_status(Some("  ")), AuthStatus::Unauthenticated);
    }
}
