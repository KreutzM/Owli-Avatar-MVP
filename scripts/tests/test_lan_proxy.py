"""The proposed HTTPS proxy is exercised on loopback only, with ephemeral test credentials."""
import os
import socket
import ssl
import http.client
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
                    if self.headers.get("X-Forwarded-For"):
                        self.send_header("X-Saw-Forwarded", "true")
                    self.end_headers()
                    self.wfile.write(b"api fixture")
                def do_POST(self):
                    self.send_response(200)
                    self.end_headers()
                    self.wfile.write(b"post fixture")
                def log_message(self, *_): pass
            api = HTTPServer(("127.0.0.1", 0), API)
            thread = threading.Thread(target=api.serve_forever, daemon=True)
            thread.start()
            env = {**os.environ, "OWLI_PROXY_API_PORT": str(api.server_port), "OWLI_HTTPS_BIND": "127.0.0.1", "OWLI_HTTPS_PORT": str(port),
                   "OWLI_ALLOWED_CIDR": "127.0.0.1/32",
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
                request = urllib.request.Request(f"https://127.0.0.1:{port}/api/health", headers={"X-Forwarded-For": "8.8.8.8"})
                with urllib.request.urlopen(request, context=context) as result:
                    self.assertEqual(result.read(), b"api fixture")
                    self.assertIsNone(result.headers.get("X-Saw-Forwarded"))
                post = urllib.request.Request(f"https://127.0.0.1:{port}/api/chat", data=b"{}", headers={
                    "Content-Type": "application/json", "Origin": f"https://127.0.0.1:{port}", "X-Owli-Request": "1"})
                with urllib.request.urlopen(post, context=context) as result:
                    self.assertEqual(result.read(), b"post fixture")
                for headers in ({"Origin": "https://evil.example", "X-Owli-Request": "1"},
                                {"Origin": f"https://127.0.0.1:{port}"}):
                    bad_post = urllib.request.Request(f"https://127.0.0.1:{port}/api/chat", data=b"{}", headers=headers)
                    with self.assertRaises(urllib.error.HTTPError) as error:
                        urllib.request.urlopen(bad_post, context=context)
                    self.assertEqual(error.exception.code, 403)
                foreign = http.client.HTTPSConnection("127.0.0.1", port, context=context,
                                                      source_address=("127.0.0.2", 0), timeout=2)
                foreign.request("GET", "/")
                self.assertEqual(foreign.getresponse().status, 403)
                foreign.close()
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

    def test_missing_or_non_private_network_configuration_fails_closed(self):
        with tempfile.TemporaryDirectory(prefix="owli-https-config-test-") as directory:
            temp = Path(directory)
            env = {**os.environ, "OWLI_HTTPS_BIND": "192.168.1.5", "OWLI_HTTPS_PORT": "8443",
                   "OWLI_HTTPS_CERT": str(temp / "missing.crt"), "OWLI_HTTPS_KEY": str(temp / "missing.key"),
                   "OWLI_WEB_DIST": str(temp), "OWLI_ALLOWED_CIDR": "0.0.0.0/0"}
            process = subprocess.run(["node", str(ROOT / "scripts/lan-https-proxy.mjs")], env=env,
                                     capture_output=True, text=True, timeout=5)
            self.assertNotEqual(process.returncode, 0)
            self.assertIn("OWLI_ALLOWED_CIDR", process.stderr)

            env["OWLI_ALLOWED_CIDR"] = ""
            process = subprocess.run(["node", str(ROOT / "scripts/lan-https-proxy.mjs")], env=env,
                                     capture_output=True, text=True, timeout=5)
            self.assertNotEqual(process.returncode, 0)

    def test_private_cidrs_with_high_bit_set_are_accepted(self):
        with tempfile.TemporaryDirectory(prefix="owli-https-cidr-test-") as directory:
            temp = Path(directory)
            for bind, cidr in (("192.168.0.5", "192.168.0.0/16"),
                               ("172.16.2.5", "172.16.0.0/12")):
                env = {**os.environ, "OWLI_HTTPS_BIND": bind, "OWLI_HTTPS_PORT": "8443",
                       "OWLI_HTTPS_CERT": str(temp / "missing.crt"), "OWLI_HTTPS_KEY": str(temp / "missing.key"),
                       "OWLI_WEB_DIST": str(temp), "OWLI_ALLOWED_CIDR": cidr}
                process = subprocess.run(["node", str(ROOT / "scripts/lan-https-proxy.mjs")], env=env,
                                         capture_output=True, text=True, timeout=5)
                self.assertNotEqual(process.returncode, 0)
                self.assertNotIn("OWLI_ALLOWED_CIDR", process.stderr, f"{cidr} should pass CIDR validation")
                self.assertIn("missing.crt", process.stderr)


if __name__ == "__main__":
    unittest.main()
