use axum::http::StatusCode;
use axum::{routing::get, Json, Router};
use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize, Serialize)]
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

    use super::{router, HealthResponse};

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
        let decoded: HealthResponse =
            serde_json::from_slice(&body).expect("response should decode as health");
        assert!(decoded.ok);
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
