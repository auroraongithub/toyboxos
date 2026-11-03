"""MCP endpoint (/mcp): handshake, auth, page + doc tools, and that writes reach a syncing device."""

import json
import os
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
PORT = 8857
TOKEN = "t" * 48


def post(path, body, token=TOKEN, method="POST"):
    r = urllib.request.Request(
        "http://127.0.0.1:%d%s" % (PORT, path),
        data=json.dumps(body).encode() if body is not None else None,
        method=method,
        headers={"Content-Type": "application/json", "Authorization": "Bearer " + token},
    )
    with urllib.request.urlopen(r, timeout=10) as res:
        raw = res.read()
        return res.status, json.loads(raw) if raw else None


class Mcp(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.dir = tempfile.mkdtemp()
        env = dict(os.environ)
        env.update(
            SOS_PORT=str(PORT),
            SOS_HOST="127.0.0.1",
            SOS_DB=os.path.join(cls.dir, "data", "t.db"),
            SOS_FILES=os.path.join(cls.dir, "files"),
            SOS_TOKEN=TOKEN,
            SOS_WWW=cls.dir,
        )
        cls.p = subprocess.Popen(
            [sys.executable, "server.py"], cwd=HERE, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
        )
        for _ in range(40):
            try:
                urllib.request.urlopen("http://127.0.0.1:%d/api/ping" % PORT, timeout=2)
                break
            except Exception:
                time.sleep(0.25)
        cls.n = 0

    @classmethod
    def tearDownClass(cls):
        cls.p.terminate()
        cls.p.wait()

    def rpc(self, method, params=None):
        Mcp.n += 1
        code, out = post("/mcp", {"jsonrpc": "2.0", "id": Mcp.n, "method": method, "params": params or {}})
        self.assertEqual(code, 200)
        self.assertNotIn("error", out, out)
        return out["result"]

    def tool(self, name, **args):
        r = self.rpc("tools/call", {"name": name, "arguments": args})
        text = r["content"][0]["text"]
        try:
            return r["isError"], json.loads(text)
        except ValueError:
            return r["isError"], text

    def test_1_handshake(self):
        r = self.rpc("initialize", {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "t"}})
        self.assertEqual(r["protocolVersion"], "2025-06-18")
        self.assertIn("tools", r["capabilities"])
        code, out = post("/mcp", {"jsonrpc": "2.0", "method": "notifications/initialized"})
        self.assertEqual((code, out), (202, None))
        names = {t["name"] for t in self.rpc("tools/list")["tools"]}
        self.assertTrue({"overview", "search", "read_page", "write_page", "list", "get", "save", "delete"} <= names)

    def test_2_auth(self):
        with self.assertRaises(urllib.error.HTTPError) as e:
            post("/mcp", {"jsonrpc": "2.0", "id": 1, "method": "tools/list"}, token="wrong")
        self.assertEqual(e.exception.code, 401)
        with self.assertRaises(urllib.error.HTTPError) as e:
            post("/mcp", None, method="GET")
        self.assertEqual(e.exception.code, 405)

    def test_3_pages(self):
        err, out = self.tool("write_page", title="Calculus", kind="subject")
        self.assertFalse(err, out)
        err, out = self.tool("write_page", title="Chain rule", body="d/dx f(g(x)) = f'(g(x)) g'(x). See [[Calculus]].",
                             under="Calculus")
        self.assertFalse(err, out)
        err, out = self.tool("write_page", title="Chain rule", body="Example: sin(x^2).", mode="append")
        self.assertFalse(err, out)
        err, page = self.tool("read_page", page="chain rule")
        self.assertFalse(err)
        self.assertIn("sin(x^2)", page["body"])
        self.assertEqual(page["parent"], "Calculus")
        err, sub = self.tool("read_page", page="Calculus")
        self.assertEqual(sub["backlinks"], ["Chain rule"])
        self.assertEqual([c["title"] for c in sub["children"]], ["Chain rule"])
        err, hits = self.tool("search", query="chain")
        self.assertTrue(any("Chain rule" in h for h in hits["pages"]))
        err, out = self.tool("write_page", title="Orphan", under="Nope")
        self.assertTrue(err)

    def test_4_docs(self):
        err, out = self.tool("save", collection="tasks", data={"title": "Finish lab report", "proj": "School"})
        self.assertFalse(err, out)
        tid = out.split("/")[1].rstrip(".")
        err, doc = self.tool("get", collection="tasks", id=tid)
        self.assertEqual((doc["col"], doc["proj"]), ("todo", "School"))
        self.assertIn("at", doc)
        err, out = self.tool("save", collection="tasks", id=tid, data={"col": "doing"})
        self.assertFalse(err)
        err, doc = self.tool("get", collection="tasks", id=tid)
        self.assertEqual((doc["col"], doc["title"]), ("doing", "Finish lab report"))
        self.assertTrue(self.tool("save", collection="tasks", id=tid, data={"col": "later"})[0])
        self.assertTrue(self.tool("save", collection="events", data={"title": "no start"})[0])
        self.assertTrue(self.tool("save", collection="classes", data={"title": "x"})[0])
        self.assertTrue(self.tool("save", collection="ticks", id="m999", data={"done": True})[0])
        start = time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime(time.time() + 3600))
        self.assertFalse(self.tool("save", collection="events", data={"title": "Study group", "start": start})[0])
        err, ov = self.tool("overview")
        self.assertFalse(err)
        self.assertIn("Study group", [e["title"] for e in ov["events_next_7_days"]])
        self.assertIn("Finish lab report", [t["title"] for t in ov["open_tasks"]])
        err, lst = self.tool("list", collection="tasks", filter="lab")
        self.assertEqual(lst["total"], 1)

        # a device syncing from scratch sees the task, then its tombstone
        _, s = post("/api/sync", {"since": 0, "docs": []})
        self.assertIn(tid, [d["id"] for d in s["docs"] if d["c"] == "tasks" and not d["d"]])
        self.assertFalse(self.tool("delete", collection="tasks", id=tid)[0])
        _, s2 = post("/api/sync", {"since": s["seq"], "docs": []})
        self.assertEqual([(d["id"], d["d"]) for d in s2["docs"]], [(tid, 1)])
        self.assertTrue(self.tool("get", collection="tasks", id=tid)[0])

    def test_5_bad_input(self):
        code, out = post("/mcp", {"jsonrpc": "2.0", "id": 9, "method": "nope"})
        self.assertEqual(out["error"]["code"], -32601)
        r = self.rpc("tools/call", {"name": "nope", "arguments": {}})
        self.assertTrue(r["isError"])


if __name__ == "__main__":
    unittest.main()
