"""Link fetching stays on the public internet, static files stay in www, junk input fails cleanly:
python -m unittest discover -s server -p test_security.py"""

import http.client
import http.server
import os
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import ai

PORT = 8872


class Public(unittest.TestCase):
    def test_private_addresses_are_refused(self):
        for ip in (
            "127.0.0.1",
            "10.1.2.3",
            "192.168.1.20",
            "172.16.0.1",
            "169.254.169.254",
            "100.64.0.1",
            "0.0.0.0",
            "::1",
            "fe80::1",
            "fd00::1",
            "::ffff:127.0.0.1",
            "224.0.0.1",
        ):
            self.assertFalse(ai._public(ip), ip)
        for ip in ("1.1.1.1", "142.250.72.14", "2606:4700:4700::1111"):
            self.assertTrue(ai._public(ip), ip)

    def test_get_refuses_local_names_and_schemes(self):
        for url in ("http://127.0.0.1:8787/api/export", "http://localhost/", "http://[::1]/", "file:///etc/passwd"):
            with self.assertRaises(ai.Blocked, msg=url):
                ai._get(url)

    def test_redirects_are_checked_too(self):
        class R(http.server.BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def do_GET(self):
                self.send_response(302)
                self.send_header(
                    "Location", "file:///etc/passwd" if self.path == "/file" else "http://[::1]:%d/x" % port
                )
                self.end_headers()

        srv = http.server.HTTPServer(("127.0.0.1", 0), R)
        port = srv.server_address[1]
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        try:
            with mock.patch.object(
                ai, "_public", lambda ip: ip == "127.0.0.1"
            ):  # pretend this one test server is public
                for path in ("/private", "/file"):
                    with self.assertRaises((ai.Blocked, ai.urllib.error.HTTPError), msg=path):
                        ai._get("http://127.0.0.1:%d%s" % (port, path))
                with self.assertRaises(ai.Blocked):
                    ai._get("http://127.0.0.1:%d/private" % port)
        finally:
            srv.shutdown()


class Static(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.dir = tempfile.mkdtemp()
        www = os.path.join(cls.dir, "www")
        os.makedirs(www)
        os.makedirs(os.path.join(cls.dir, "www2"))
        open(os.path.join(www, "index.html"), "w").write("<p>app</p>")
        open(os.path.join(cls.dir, "www2", "secret.txt"), "w").write("secret")
        env = {k: v for k, v in os.environ.items() if k != "SOS_TOKEN"}
        env.update(
            SOS_PORT=str(PORT),
            SOS_HOST="127.0.0.1",
            SOS_DB=os.path.join(cls.dir, "data", "t.db"),
            SOS_FILES=os.path.join(cls.dir, "files"),
            SOS_TOKEN_FILE=os.path.join(cls.dir, "token.txt"),
            SOS_WWW=www,
        )
        cls.p = subprocess.Popen(
            [sys.executable, "server.py"], cwd=HERE, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
        )
        for _ in range(40):
            try:
                cls.req("GET", "/api/ping")
                break
            except OSError:
                time.sleep(0.25)
        cls.token = open(env["SOS_TOKEN_FILE"]).read().strip()

    @classmethod
    def tearDownClass(cls):
        cls.p.terminate()
        cls.p.wait()

    @staticmethod
    def req(method, path, body=None, headers=None):
        c = http.client.HTTPConnection("127.0.0.1", PORT, timeout=5)
        c.putrequest(method, path, skip_accept_encoding=True)
        for k, v in (headers or {}).items():
            c.putheader(k, v)
        c.endheaders(body)
        r = c.getresponse()
        out = (r.status, dict(r.getheaders()), r.read())
        c.close()
        return out

    def test_sibling_folder_is_not_served(self):
        st, h, body = self.req("GET", "/../www2/secret.txt")
        self.assertNotIn(b"secret", body)
        self.assertEqual(body, b"<p>app</p>")

    def test_app_pages_cannot_be_framed(self):
        st, h, _ = self.req("GET", "/")
        self.assertEqual(h.get("X-Frame-Options"), "SAMEORIGIN")
        self.assertEqual(h.get("X-Content-Type-Options"), "nosniff")

    def test_junk_content_length_is_a_clean_error(self):
        st, _, _ = self.req(
            "POST", "/api/sync", headers={"Authorization": "Bearer " + self.token, "Content-Length": "abc"}
        )
        self.assertEqual(st, 200)  # treated as an empty body, which sync answers with no changes
        st, _, _ = self.req("POST", "/api/pair/claim", headers={"Content-Length": "-5"})
        self.assertEqual(st, 403)

    def test_blocked_link_reads_say_why(self):
        b = b'{"url":"http://127.0.0.1:8787/"}'
        st, _, body = self.req(
            "POST", "/api/web/read", b, {"Authorization": "Bearer " + self.token, "Content-Length": str(len(b))}
        )
        self.assertEqual(st, 400)
        self.assertIn(b"private network", body)


if __name__ == "__main__":
    unittest.main()
