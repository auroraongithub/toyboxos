"""Self-updates: the release channel, checks on the download, the web switch, server code for the supervisor,
and Osage's changes put back on a new release (the ones that no longer fit set aside)."""

from contextlib import ExitStack
import hashlib
import http.server
import io
import json
import os
import shutil
import tempfile
import threading
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch
import app_changes as changes
import updates


def release(build, files, extra=()):
    b = io.BytesIO()
    with zipfile.ZipFile(b, "w") as z:
        z.writestr("dist/version.json", json.dumps({"build": build, "api": 1}))
        z.writestr("dist/index.html", "<p>" + build)
        for n, t in files.items():
            z.writestr(n, t)
        for n in extra:
            z.writestr(n, "x")
        z.writestr(
            "manifest.json",
            json.dumps(
                {"build": build, "runtime": 1, "server": sorted(n[7:] for n in files if n.startswith("server/"))}
            ),
        )
    return b.getvalue()


class UpdatesTest(unittest.TestCase):
    def setUp(self):
        self.s = ExitStack()
        self.addCleanup(self.s.close)
        self.home = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.home, True)
        www = os.path.join(self.home, "www")
        os.makedirs(www)
        with open(os.path.join(www, "version.json"), "w") as f:
            json.dump({"build": "aaaa1"}, f)
        self.files = {}
        files = self.files

        class F(http.server.BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def do_GET(self):
                b = files.get(self.path)
                self.send_response(200 if b else 404)
                self.send_header("Content-Length", str(len(b or b"")))
                self.end_headers()
                self.wfile.write(b or b"")

        self.srv = http.server.HTTPServer(("127.0.0.1", 0), F)
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()
        self.addCleanup(self.srv.shutdown)
        self.restarts = []
        for k, v in {
            "HOME": self.home,
            "STATE": os.path.join(self.home, "update.json"),
            "WEB": os.path.join(self.home, "web"),
            "CODE": os.path.join(self.home, "code"),
            "_www": lambda: self.www(),
            "_restart": lambda: self.restarts.append(1),
        }.items():
            self.s.enter_context(patch.object(updates, k, v))
        self.s.enter_context(
            patch.dict(
                os.environ,
                {
                    "SOS_UPDATES": "1",
                    "SOS_RUNTIME": "1",
                    "SOS_SUPERVISED": "",
                    "SOS_UPDATE_URL": "http://127.0.0.1:%d/latest.json" % self.srv.server_address[1],
                },
            )
        )
        self.s.enter_context(patch.object(changes, "available", return_value=False))
        updates.st.update(latest=None, err="", state="idle")

    def www(self):
        try:
            return os.path.join(self.home, "web", open(os.path.join(self.home, "web", "current")).read().strip())
        except OSError:
            return os.path.join(self.home, "www")

    def publish(self, build, data, sha=None):
        self.files["/r.zip"] = data
        self.files["/latest.json"] = json.dumps(
            {"build": build, "url": "r.zip", "sha256": sha or hashlib.sha256(data).hexdigest(), "runtime": 1}
        ).encode()

    def test_newer_release_switches_the_app(self):
        self.publish("aaaa2", release("aaaa2", {"server/server.py": "# new"}))
        s = updates.check()
        self.assertTrue(s["newer"])
        self.assertEqual(s["latest"], "aaaa2")
        s = updates.apply()
        self.assertEqual(s["build"], "aaaa2")
        self.assertEqual(s["err"], "")
        self.assertFalse(updates.check()["newer"])
        self.assertEqual(self.restarts, [])  # not supervised: no server code, no restart
        self.assertFalse(os.path.exists(os.path.join(self.home, "code")))

    def test_bad_downloads_change_nothing(self):
        self.publish("aaaa2", release("aaaa2", {}), sha="0" * 64)
        self.assertIn("doesn't match", updates.apply()["err"])
        self.publish("aaaa3", release("aaaa3", {}, extra=["../evil.txt"]))
        updates.st["latest"] = None
        self.assertIn("unexpected file", updates.apply()["err"])
        self.assertEqual(updates.current(), "aaaa1")
        self.assertFalse(os.path.exists(os.path.join(self.home, "..", "evil.txt")))

    def test_server_code_goes_to_the_supervisor(self):
        os.environ["SOS_SUPERVISED"] = "1"
        self.publish("aaaa2", release("aaaa2", {"server/server.py": "# new", "server/json.py": "# shadows stdlib"}))
        updates.apply()
        c = json.load(open(os.path.join(self.home, "code", "current.json")))
        self.assertEqual((c["dir"], c["trial"]), ("aaaa2", True))
        self.assertEqual(os.listdir(os.path.join(self.home, "code", "aaaa2")), ["server.py"])  # never a stdlib name
        threading.Event().wait(1.3)
        self.assertEqual(self.restarts, [1])

    def test_release_needing_a_newer_program_only_updates_the_app(self):
        os.environ.update(SOS_SUPERVISED="1", SOS_RUNTIME="0")
        self.publish("aaaa2", release("aaaa2", {"server/server.py": "# new"}))
        self.assertEqual(updates.apply()["build"], "aaaa2")
        self.assertFalse(os.path.exists(os.path.join(self.home, "code")))

    def test_off_unless_enabled(self):
        os.environ["SOS_UPDATES"] = ""
        with self.assertRaises(ValueError):
            updates.check()


class RebaseTest(unittest.TestCase):
    def setUp(self):
        self.s = ExitStack()
        self.addCleanup(self.s.close)
        t = Path(self.s.enter_context(tempfile.TemporaryDirectory(ignore_cleanup_errors=True)))
        for name, path in {
            "ROOT": t,
            "REPO": t / "source",
            "JOBS": t / "drafts",
            "RELEASES": t / "releases",
            "WWW": t / "www",
        }.items():
            self.s.enter_context(patch.object(changes, name, path))
        self.t = t
        r = changes.REPO
        (r / "src/modules").mkdir(parents=True)
        (r / "src/styles").mkdir(parents=True)
        (t / "tools/marked").mkdir(parents=True)
        (r / "src/modules/today.js").write_text("export const title = 'Today';\nexport const n = 1;\n")
        (r / "src/styles/custom.css").write_text("/* custom */\n")
        (r / ".gitignore").write_text("dist/\nnode_modules/\n")
        changes.git("init", "-q", cwd=r)
        for k, v in (("user.name", "Osage"), ("user.email", "osage@toybox.local")):
            changes.git("config", k, v)
        changes.git("add", ".")
        changes.git("commit", "-q", "-m", "Baseline")

        def change(path, old, new, req):
            f = r / path
            f.write_text(f.read_text().replace(old, new))
            changes.git("commit", "-q", "-am", "Osage: " + req)
            c = changes.git("rev-parse", "HEAD")
            jid = hashlib.md5(req.encode()).hexdigest()
            (changes.JOBS / jid).mkdir(parents=True, exist_ok=True)
            changes.save({"id": jid, "status": "applied", "commit": c, "request": req, "at": "x"})

        change("src/modules/today.js", "'Today'", "'My day'", "rename Today")
        change("src/styles/custom.css", "/* custom */", ".x{color:red}", "red x")
        self.built = []

        def build(work, out, bid):
            out.mkdir(parents=True, exist_ok=True)
            self.built.append(
                (work / "src/modules/today.js").read_text() + (work / "src/styles/custom.css").read_text()
            )
            for f in ("app.js", "app.css"):
                (out / f).write_text(bid)

        self.s.enter_context(patch.object(changes, "build", build))
        self.live = []
        self.s.enter_context(patch.object(changes, "activate", lambda rel: self.live.append(rel)))

    def incoming(self, today):
        inc = self.t / "inc"
        shutil.rmtree(inc, ignore_errors=True)
        (inc / "src/modules").mkdir(parents=True)
        (inc / "src/styles").mkdir(parents=True)
        (inc / "dist").mkdir()
        (inc / "src/modules/today.js").write_text(today)
        (inc / "src/styles/custom.css").write_text("/* custom */\n")
        (inc / "dist/version.json").write_text(json.dumps({"build": "bbbb1", "api": 1}))
        for f in ("app.js", "app.css", "index.html"):
            (inc / "dist" / f).write_text("release")
        return inc

    def test_changes_that_fit_stay_and_the_rest_are_set_aside(self):
        # the release rewrites the same line Osage renamed: that change no longer fits, the CSS one does
        out = changes.rebase(self.incoming("export const title = 'Home';\nexport const n = 2;\n"), "bbbb1")
        self.assertEqual(out["kept"], 1)
        self.assertEqual(out["set_aside"], ["rename Today"])
        head = changes.REPO
        self.assertIn("'Home'", (head / "src/modules/today.js").read_text())
        self.assertIn(".x{color:red}", (head / "src/styles/custom.css").read_text())
        self.assertEqual(len(self.live), 1)
        self.assertNotEqual(self.live[0].name, "bbbb1")  # rebuilt with a new id
        self.assertEqual(json.loads((self.live[0] / "version.json").read_text())["api"], 1)
        states = {
            s["request"]: s["status"] for s in (json.loads(p.read_text()) for p in changes.JOBS.glob("*/state.json"))
        }
        self.assertEqual(states["rename Today"], "set_aside")
        self.assertEqual(states["red x"], "applied")
        # next release: only the kept change is re-applied, on top of the new upstream
        out = changes.rebase(self.incoming("export const title = 'Home';\nexport const n = 3;\n"), "bbbb2")
        self.assertEqual((out["kept"], out["set_aside"]), (1, []))

    def test_release_with_nothing_of_mine_ships_as_is(self):
        changes.git("reset", "-q", "--hard", "HEAD~2")
        out = changes.rebase(self.incoming("export const title = 'Home';\n"), "bbbb1")
        self.assertEqual((out["build"], out["kept"], self.built), ("bbbb1", 0, []))


if __name__ == "__main__":
    unittest.main()
