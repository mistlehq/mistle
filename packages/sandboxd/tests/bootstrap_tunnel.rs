use std::net::TcpListener;
use std::sync::mpsc;
use std::thread;

use tungstenite::Message;
use tungstenite::accept_hdr;
use tungstenite::handshake::server::{Request, Response};

#[test]
fn connects_to_bootstrap_tunnel_with_bootstrap_token_query() {
    let listener = TcpListener::bind("127.0.0.1:0").expect("listener should bind");
    let address = listener
        .local_addr()
        .expect("listener should expose its address");
    let (request_path_sender, request_path_receiver) = mpsc::channel();

    let server_thread = thread::spawn(move || {
        let (stream, _) = listener.accept().expect("server should accept a client");
        #[allow(clippy::result_large_err)]
        let mut websocket = accept_hdr(stream, |request: &Request, response: Response| {
            request_path_sender
                .send(request.uri().to_string())
                .expect("request path should be observable");
            Ok(response)
        })
        .expect("server handshake should succeed");

        let message = websocket
            .read()
            .expect("server should receive close frame from client");
        assert!(matches!(message, Message::Close(_)));
    });

    let mut tunnel = sandboxd::tunnel::connect_bootstrap_tunnel(
        &format!("ws://127.0.0.1:{}/bootstrap", address.port()),
        " bootstrap-token ",
    )
    .expect("bootstrap tunnel should connect");

    assert_eq!(
        tunnel.connected_url(),
        format!(
            "ws://127.0.0.1:{}/bootstrap?bootstrap_token=bootstrap-token",
            address.port()
        )
    );
    assert_eq!(
        request_path_receiver
            .recv()
            .expect("server should observe the request path"),
        "/bootstrap?bootstrap_token=bootstrap-token"
    );

    tunnel
        .close()
        .expect("bootstrap tunnel should close cleanly");
    server_thread
        .join()
        .expect("server thread should finish cleanly");
}

#[test]
fn rejects_non_websocket_gateway_urls() {
    let error = sandboxd::tunnel::connect_bootstrap_tunnel(
        "https://gateway.example.test/bootstrap",
        "bootstrap-token",
    )
    .expect_err("non-websocket gateway url should be rejected");

    assert_eq!(
        error.to_string(),
        "sandbox tunnel gateway ws url must use ws or wss scheme"
    );
}
