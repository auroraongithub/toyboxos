from contextlib import ExitStack
import json
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import patch

import app_changes as changes


class AppChangeTests(unittest.TestCase):
    def setUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.temp = Path(
            self.stack.enter_context(
                tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parent, ignore_cleanup_errors=True)
            )
        )
        for name, path in {
            "ROOT": self.temp,
            "REPO": self.temp / "source",
            "JOBS": self.temp / "drafts",
            "RELEASES": self.temp / "releases",
            "WWW": self.temp / "www",
        }.items():
            self.stack.enter_context(patch.object(changes, name, path))
        self.repo = changes.REPO
        (self.repo / "src/modules").mkdir(parents=True)
        (self.repo / "src/styles").mkdir(parents=True)
        (self.repo / "src/modules/today.js").write_text("export const title = 'Today';\n")
        (self.repo / "src/styles/custom.css").write_text("/* custom styles */\n")
        (self.repo / ".gitignore").write_text("dist/\nnode_modules/\n")
        changes.git("init", cwd=self.repo)
        changes.git("config", "user.name", "Test")
        changes.git("config", "user.email", "test@example.invalid")
        changes.git("add", ".")
        changes.git("commit", "-m", "Initial")

    def test_protected_paths_and_path_traversal(self):
        for path in [
            "server/ai.py",
            "src/core/ai.js",
            "../token.txt",
            "src/modules/../../token.txt",
            "src/modules/buddy.js",
            "src/modules/app-changes.js",
            "src/styles/app-changes.css",
            "src/modules/a.js/extra",
        ]:
            self.assertFalse(changes.editable(path), path)
        self.assertTrue(changes.editable("src/modules/reading.js"))
        self.assertTrue(changes.editable("src/styles/custom.css"))
        self.assertNotIn("apply", [tool["function"]["name"] for tool in changes.TOOLS])
        self.assertNotIn("shell", [tool["function"]["name"] for tool in changes.TOOLS])

    def test_picked_model_must_be_in_catalogue_and_runnable(self):
        with (
            patch.object(changes.ai, "models", return_value=["a:good", "a:capped"]),
            patch.object(
                changes.ai, "why_not", side_effect=lambda m: "monthly cap reached" if m == "a:capped" else None
            ),
        ):
            with self.assertRaisesRegex(ValueError, "model list"):
                changes.create({"request": "x", "model": "evil:model"})
            with self.assertRaisesRegex(ValueError, "cap"):
                changes.create({"request": "x", "model": "a:capped"})
            # A picked model is used as is, never swapped for the fallback chain.
            with (
                patch.object(changes.ai, "info", return_value={"model": "a:good"}) as info,
                patch.object(changes.ai, "route") as route,
            ):
                with self.assertRaises(Exception):
                    changes.complete([{"role": "user", "content": "x"}], {"want": "a:good", "cost": 0.5})
                info.assert_called_once_with("a:good")
                route.assert_not_called()

    def test_edits_require_read_and_unique_match(self):
        state = {"files": []}
        args = {"path": "src/modules/today.js", "old": "Today", "new": "My day"}
        with self.assertRaises(ValueError):
            changes.edit_file(self.repo, args, state)
        changes.read_file(self.repo, {"path": args["path"]}, state)
        changes.edit_file(self.repo, args, state)
        self.assertIn("My day", (self.repo / args["path"]).read_text())
        with self.assertRaises(ValueError):
            changes.edit_file(self.repo, {**args, "old": ""}, state)
        with self.assertRaises(ValueError):
            changes.edit_file(self.repo, args, state)

    def test_diff_does_not_write_live_app(self):
        job = "a" * 32
        (changes.JOBS / job).mkdir(parents=True)
        state = {"id": job, "files": ["src/modules/today.js"], "base": changes.git("rev-parse", "HEAD")}
        (self.repo / "src/modules/today.js").write_text("export const title = 'My day';\n")
        changes.review(state, self.repo)
        diff = (changes.JOBS / job / "change.diff").read_text()
        self.assertIn("-export const title = 'Today';", diff)
        self.assertIn("+export const title = 'My day';", diff)
        self.assertFalse(changes.WWW.exists())

    def test_public_state_hides_internal_context(self):
        self.assertEqual(
            changes.public({"id": "a", "messages": ["private"], "read": ["code"], "outputs": []}), {"id": "a"}
        )
        for bad in [None, "../a", "a" * 31, "z" * 32]:
            with self.assertRaises(ValueError):
                changes.load(bad)

    def test_apply_rejects_stale_base_before_editing(self):
        state = {"id": "a" * 32, "status": "ready", "base": changes.git("rev-parse", "HEAD"), "live": "old"}
        changes.save(state)
        with self.assertRaises(ValueError):
            changes.apply({"id": state["id"], "base": "wrong"})
        self.assertEqual(changes.git("rev-parse", "HEAD"), state["base"])
        with self.assertRaises(ValueError):
            changes.apply({"id": state["id"], "base": state["base"]})

    @unittest.skipUnless(shutil.which("bwrap"), "Release flow runs on Linux")
    def test_publish_and_rollback_preserve_data_and_history(self):
        changes.RELEASES.mkdir()
        initial = changes.RELEASES / "initial"
        initial.mkdir()
        for name, value in {
            "app.js": "original",
            "app.css": "original",
            "index.html": "<div id='app'></div>",
            "version.json": '{"build":"one","api":1}',
        }.items():
            (initial / name).write_text(value)
        changes.WWW.symlink_to(initial, target_is_directory=True)
        database = self.temp / "data.db"
        database.write_bytes(b"user data remains untouched")
        marker = self.temp / "tools/marked"
        marker.mkdir(parents=True)
        state = {
            "id": "b" * 32,
            "status": "ready",
            "request": "Change title",
            "at": "now",
            "base": changes.git("rev-parse", "HEAD"),
            "live": changes.fingerprint(),
            "build": "two",
            "files": ["src/modules/today.js"],
        }
        changes.save(state)
        work = changes.JOBS / state["id"] / "work"
        changes.git("worktree", "add", "--detach", str(work), state["base"])
        (work / "src/modules/today.js").write_text("export const title = 'My day';\n")
        built = changes.JOBS / state["id"] / "built"
        built.mkdir()
        (built / "app.js").write_text("changed")
        (built / "app.css").write_text("changed")
        result = changes.apply({"id": state["id"], "base": state["base"]})
        self.assertEqual(result["status"], "applied")
        self.assertEqual((changes.WWW / "app.js").read_text(), "changed")

        def fake_build(work, output, build):
            output.mkdir()
            (output / "app.js").write_text("restored " + build)
            (output / "app.css").write_text("restored")

        with patch.object(changes, "build", fake_build):
            changes.rollback({"id": state["id"]})
        self.assertIn("'Today'", (changes.REPO / "src/modules/today.js").read_text())
        self.assertEqual(len(changes.git("log", "--oneline").splitlines()), 3)
        self.assertEqual(database.read_bytes(), b"user data remains untouched")
        self.assertNotEqual(json.loads((changes.WWW / "version.json").read_text())["build"], "one")


if __name__ == "__main__":
    unittest.main()
