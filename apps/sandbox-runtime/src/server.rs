use axum::http::StatusCode;
use axum::{routing::get, Json, Router};
use serde::Serialize;

#[derive(Debug, Serialize)]
struct HealthResponse {
    ok: bool,
}

pub fn router() -> Router {
    Router::new().route("/__healthz", get(health_handler))
}

async fn health_handler() -> (StatusCode, Json<HealthResponse>) {
    (StatusCode::OK, Json(HealthResponse { ok: true }))
}

#[cfg(test)]
mod tests {
    use axum::body::{to_bytes, Body};
    use axum::http::{Request, StatusCode};
    use tower::ServiceExt;

    use super::router;

    #[tokio::test]
    async fn new_handler_healthz() {
        let response = router()
            .oneshot(
                Request::builder()
                    .uri("/__healthz")
                    .body(Body::empty())
                    .expect("request should build"),
            )
            .await
            .expect("handler should respond");

        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response
                .headers()
                .get("content-type")
                .expect("content-type should be set"),
            "application/json"
        );

        let body = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("response body should be readable");
        assert_eq!(body.as_ref(), br#"{"ok":true}"#);
    }

    #[tokio::test]
    async fn new_handler_unknown_path() {
        let response = router()
            .oneshot(
                Request::builder()
                    .uri("/healthz")
                    .body(Body::empty())
                    .expect("request should build"),
            )
            .await
            .expect("handler should respond");

        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }
}
