import sys
from http.server import BaseHTTPRequestHandler, HTTPServer


port = int(sys.argv[1])
marker = sys.argv[2] if len(sys.argv) > 2 else "http-listener"


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        body = marker.encode("utf-8")
        self.send_response(200)
        self.send_header("content-type", "text/plain; charset=utf-8")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):
        return


HTTPServer(("127.0.0.1", port), Handler).serve_forever()
