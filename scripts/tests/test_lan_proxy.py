"""The proposed HTTPS proxy is exercised on loopback only, with ephemeral test credentials."""
import os
import socket
import ssl
import subprocess
import tempfile
import time
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
import unittest
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


class LanProxyTest(unittest.TestCase):
    def test_tls_static_root_and_path_boundary(self):
        with tempfile.TemporaryDirectory(prefix="owli-https-test-") as directory:
            temp = Path(directory)
            root = temp / "dist"
            root.mkdir()
            (root / "index.html").write_text("fixture", encoding="utf-8")
            (temp / "private.txt").write_text("private", encoding="utf-8")
            subprocess.run(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes",
                            "-keyout", str(temp / "key.pem"), "-out", str(temp / "cert.pem"),
                            "-days", "1", "-subj", "/CN=localhost"],
                           check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            with socket.socket() as probe:
                probe.bind(("127.0.0.1", 0))
                port = probe.getsockname()[1]
            class API(BaseHTTPRequestHandler):
                def do_GET(self):
                    self.send_response(200)
                    self.end_headers()
                    self.wfile.write(b"api fixture")
                def log_message(self, *_): pass
            api = HTTPServer(("127.0.0.1", 0), API)
            thread = threading.Thread(target=api.serve_forever, daemon=True)
            thread.start()
            env = {**os.environ, "OWLI_PROXY_API_PORT": str(api.server_port), "OWLI_HTTPS_BIND": "127.0.0.1", "OWLI_HTTPS_PORT": str(port),
                   "OWLI_HTTPS_KEY": str(temp / "key.pem"), "OWLI_HTTPS_CERT": str(temp / "cert.pem"),
                   "OWLI_WEB_DIST": str(root)}
            process = subprocess.Popen(["node", str(ROOT / "scripts/lan-https-proxy.mjs")], env=env,
                                       stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
            try:
                context = ssl._create_unverified_context()
                for _ in range(100):
                    try:
                        with urllib.request.urlopen(f"https://127.0.0.1:{port}/", context=context, timeout=1) as result:
                            self.assertEqual(result.read(), b"fixture")
                        break
                    except OSError:
                        if process.poll() is not None:
                            self.fail(process.stderr.read().decode())
                        time.sleep(.05)
                else:
                    self.fail("proxy did not start")
                with urllib.request.urlopen(f"https://127.0.0.1:{port}/api/health", context=context) as result:
                    self.assertEqual(result.read(), b"api fixture")
                with self.assertRaises(urllib.error.HTTPError) as error:
                    urllib.request.urlopen(f"https://127.0.0.1:{port}/%2e%2e/private.txt", context=context)
                self.assertEqual(error.exception.code, 404)
                with self.assertRaises(urllib.error.HTTPError) as error:
                    urllib.request.urlopen(f"https://127.0.0.1:{port}/api/diagnostics", context=context)
                self.assertEqual(error.exception.code, 404)
                with self.assertRaises(urllib.error.HTTPError) as error:
                    urllib.request.urlopen(f"https://127.0.0.1:{port}/api/%64iagnostics", context=context)
                self.assertEqual(error.exception.code, 404)
            finally:
                process.terminate()
                process.wait(timeout=5)
                process.stderr.close()
                api.shutdown()
                thread.join(timeout=2)
                api.server_close()


if __name__ == "__main__":
    unittest.main()
