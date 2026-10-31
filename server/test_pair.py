"""Pairing codes and the first-start token: python -m unittest discover -s server -p test_pair.py"""

import json
import os
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.request
import urllib.error

HERE = os.path.dirname(os.path.abspath(__file__))
PORT = 8871


def call(path, body=None, token=None, method=None):
    r = urllib.request.Request(
        f"http://127.0.0.1:{PORT}{path}",
        data=None if body is None else json.dumps(body).encode(),
        headers={"Content-Type": "application/json", **({"Authorization": "Bearer " + token} if token else {})},
        method=method,
    )
    try:
        with urllib.request.urlopen(r, timeout=5) as res:
            return res.status, json.loads(res.read() or b"{}")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")


class Pairing(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.dir = tempfile.mkdtemp()
        cls.env = {k: v for k, v in os.environ.items() if k != "SOS_TOKEN"}
        cls.env.update(
            SOS_PORT=str(PORT),
            SOS_HOST="127.0.0.1",
            SOS_DB=os.path.join(cls.dir, "data", "t.db"),
            SOS_FILES=os.path.join(cls.dir, "files"),
            SOS_TOKEN_FILE=os.path.join(cls.dir, "token.txt"),
            SOS_WWW=cls.dir,
        )
        cls.p = subprocess.Popen(
            [sys.executable, "server.py"], cwd=HERE, env=cls.env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
        )
        for _ in range(40):
            try:
                call("/api/ping")
                break
            except Exception:
                time.sleep(0.25)
        cls.token = open(cls.env["SOS_TOKEN_FILE"]).read().strip()

    @classmethod
    def tearDownClass(cls):
        cls.p.terminate()
        cls.p.wait()

    def cli_code(self):
        return (
            subprocess.run(
                [sys.executable, "server.py", "pair"],
                cwd=HERE,
                env=self.env,
                capture_output=True,
                text=True,
                check=True,
            )
            .stdout.strip()
            .splitlines()[-1]
        )

    def test_1_token_made_on_first_start(self):
        self.assertGreaterEqual(len(self.token), 40)
        if os.name == "posix":
            self.assertEqual(os.stat(self.env["SOS_TOKEN_FILE"]).st_mode & 0o777, 0o600)
        self.assertEqual(call("/api/ping", token=self.token)[0], 200)

    def test_2_cli_code_trades_once(self):
        code = self.cli_code()
        self.assertRegex(code, r"^[A-Z2-9]{4}-[A-Z2-9]{4}$")
        self.assertEqual(
            call("/api/pair/claim", {"code": code.lower().replace("-", " ")}), (200, {"token": self.token})
        )
        self.assertEqual(call("/api/pair/claim", {"code": code})[0], 403)

    def test_3_new_code_needs_the_token(self):
        self.assertEqual(call("/api/pair/new", {}, token="nope")[0], 401)
        st, out = call("/api/pair/new", {}, token=self.token)
        self.assertEqual(st, 200)
        self.assertEqual(call("/api/pair/claim", {"code": out["code"]})[1].get("token"), self.token)

    def test_4_pair_file_has_no_plain_codes(self):
        code = self.cli_code()
        raw = open(os.path.join(self.dir, "data", "pair.json")).read()
        self.assertNotIn(code.replace("-", ""), raw)

    def test_5_guessing_locks_it(self):
        code = self.cli_code()
        for _ in range(20):
            call("/api/pair/claim", {"code": "AAAA-AAAA"})
        self.assertEqual(call("/api/pair/claim", {"code": code})[0], 429)


if __name__ == "__main__":
    unittest.main()
