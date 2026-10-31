from contextlib import ExitStack, redirect_stderr, redirect_stdout
from email.message import Message
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import tarfile
import threading
import unittest
from unittest.mock import patch
import urllib.error
import urllib.parse
import urllib.request

os.environ["SOS_MOODLE_SITE"] = SITE = "https://moodle.example.edu"  # an invented site
import moodle
import moodle_setup


# These are invented fixtures, not credentials from a real Moodle account.
TOKEN = "a" * 32
PASSWORD = "fixture-password-never-print"
FILE_URL = SITE + "/webservice/pluginfile.php/1/mod_resource/content/1/lesson.pdf"
INFO = {
    "userid": 7,
    "fullname": "Test Student",
    "downloadfiles": 1,
    "functions": [{"name": f} for f in sorted(moodle.READ_FUNCTIONS)],
}


class Response(io.BytesIO):
    def __init__(self, content, ctype="application/json"):
        super().__init__(content)
        self.headers = Message()
        self.headers["Content-Type"] = ctype


class MoodleTests(unittest.TestCase):
    def setUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.root = Path(self.stack.enter_context(tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parent)))
        self.stack.enter_context(patch.object(moodle, "KEY_FILE", self.root / "moodle_key.txt"))
        self.stack.enter_context(patch.object(moodle, "DOWNLOADS", self.root / "private"))

    def client(self):
        moodle.save_token(TOKEN)
        return moodle.Client.configured()

    def upstream(self, function, fields=None):
        if function == "core_webservice_get_site_info":
            return INFO
        if function == "core_enrol_get_users_courses":
            self.assertEqual(fields, {"userid": 7, "returnusercount": 0})
            return [{"id": 123, "fullname": "Test course"}]
        if function == "core_course_get_contents":
            return [
                {
                    "id": 1,
                    "modules": [
                        {
                            "id": 321,
                            "contents": [
                                {"type": "url", "fileurl": "https://external.example/"},
                                {
                                    "type": "file",
                                    "fileurl": FILE_URL + "?forcedownload=1",
                                    "filename": "../../lesson.pdf",
                                    "timemodified": 10,
                                },
                            ],
                        }
                    ],
                }
            ]
        if function == "mod_forum_get_forums_by_courses":
            return [{"id": 456, "type": "news"}]
        if function == "mod_forum_get_forum_discussions":
            return {"discussions": [{"id": 90, "discussion": 789, "message": "Read chapter 3"}]}
        if function == "mod_forum_get_discussion_posts":
            return {"posts": [{"id": 90, "message": "Read chapter 3"}]}
        if function == "mod_assign_get_assignments":
            return {"courses": [{"id": 123, "assignments": [{"id": 1, "duedate": 1793200000}]}]}
        self.fail("Unexpected function: " + function)

    def test_login_posts_credentials_and_drops_private_token(self):
        with patch.object(moodle.urllib.request, "build_opener") as factory:
            factory.return_value.open.return_value = Response(
                json.dumps({"token": TOKEN, "privatetoken": "private"}).encode()
            )
            self.assertEqual(moodle.login("student", PASSWORD), TOKEN)
            request = factory.return_value.open.call_args.args[0]
            self.assertEqual(request.full_url, SITE + "/login/token.php")
            self.assertNotIn(PASSWORD, request.full_url)
            fields = urllib.parse.parse_qs(request.data.decode())
            self.assertEqual(fields["password"], [PASSWORD])
            self.assertEqual(fields["service"], ["moodle_mobile_app"])

    def test_transport_errors_and_raw_moodle_messages_never_escape(self):
        errors = [
            urllib.error.URLError("secret " + TOKEN),
            urllib.error.HTTPError(FILE_URL + "?token=" + TOKEN, 302, TOKEN, {}, io.BytesIO()),
        ]
        for error in errors:
            with patch.object(moodle.urllib.request, "build_opener") as factory:
                factory.return_value.open.side_effect = error
                with self.assertRaises(moodle.MoodleError) as caught:
                    moodle._json_request("/login/token.php", {"password": PASSWORD})
                self.assertNotIn(TOKEN, str(caught.exception))
                self.assertNotIn(PASSWORD, str(caught.exception))
        with patch.object(
            moodle,
            "_request",
            return_value=(
                json.dumps({"exception": "error", "errorcode": "invalidtoken", "message": TOKEN + PASSWORD}).encode(),
                "application/json",
            ),
        ):
            with self.assertRaisesRegex(moodle.MoodleError, "expired"):
                moodle._json_request("/webservice/rest/server.php", {})

    def test_redirects_are_disabled_and_oversized_responses_fail(self):
        self.assertIsNone(moodle.NoRedirect().redirect_request(None, None, 302, "", {}, "https://elsewhere.invalid/"))
        with patch.object(moodle.urllib.request, "build_opener") as factory:
            factory.return_value.open.return_value = Response(b"12345")
            with self.assertRaisesRegex(moodle.MoodleError, "size limit"):
                moodle._request(urllib.request.Request(SITE), 4)

    def test_rest_uses_post_and_only_read_functions(self):
        client = self.client()
        with patch.object(moodle, "_json_request", return_value=INFO) as request:
            client.info()
            fields = request.call_args.args[1]
            self.assertEqual(fields["wstoken"], TOKEN)
            self.assertEqual(fields["wsfunction"], "core_webservice_get_site_info")
        with patch.object(moodle, "_json_request") as request:
            with self.assertRaises(moodle.MoodleError):
                client.call("mod_assign_submit_for_grading", {})
            request.assert_not_called()

    def test_unconnected_status_and_rejected_caller_credentials(self):
        self.assertEqual(moodle.handle({"action": "status"})["connected"], False)
        for body in [
            {"action": "submit"},
            {"action": []},
            {"action": "courses", "password": PASSWORD},
            {"action": "download", "url": FILE_URL},
            {"function": "core_user_get_users"},
            [],
        ]:
            with self.assertRaises(moodle.MoodleError):
                moodle.handle(body)
        with self.assertRaisesRegex(moodle.MoodleError, "not connected"):
            moodle.handle({"action": "courses"})

    def test_status_and_nested_output_do_not_disclose_tokens(self):
        client = self.client()
        result = client.public(
            {
                "token": TOKEN,
                "nested": [
                    {
                        "fileurl": FILE_URL + "?token=" + TOKEN,
                        "html": '<a href="/file?x=1&amp;sesskey=anothersecret">file</a>',
                        "privatetoken": "private",
                        "tokenlike": TOKEN,
                    }
                ],
            }
        )
        serialized = json.dumps(result)
        self.assertNotIn(TOKEN, serialized)
        self.assertNotIn("anothersecret", serialized)
        self.assertNotIn("privatetoken", serialized)
        with patch.object(moodle.Client, "call", return_value={**INFO, "token": TOKEN, "password": PASSWORD}):
            status = moodle.handle({"action": "status"})
        self.assertTrue(status["connected"])
        self.assertNotIn(TOKEN, json.dumps(status))
        self.assertNotIn(PASSWORD, json.dumps(status))

    def test_enrollment_scope_assignments_and_forum_page_checks(self):
        self.client()
        with patch.object(moodle.Client, "call", side_effect=self.upstream) as call:
            self.assertEqual(moodle.handle({"action": "courses", "userid": 999})[0]["id"], 123)
            assignments = moodle.handle({"action": "assignments", "course": 123})
            self.assertEqual(assignments["courses"][0]["id"], 123)
            posts = moodle.handle({"action": "posts", "course": 123, "forum": 456, "discussion": 789})
            self.assertEqual(posts["posts"][0]["id"], 90)
            for body in [
                {"action": "contents", "course": 999},
                {"action": "discussions", "course": 123, "forum": 999},
                {"action": "posts", "course": 123, "forum": 456, "discussion": 90},
                {"action": "contents", "course": True},
                {"action": "discussions", "course": 123, "forum": 456, "page": -1},
            ]:
                with self.assertRaises(moodle.MoodleError):
                    moodle.handle(body)
            for args in call.call_args_list:
                self.assertIn(args.args[0], moodle.READ_FUNCTIONS)

    def test_download_is_private_binary_exact_and_handles_moodle_query(self):
        self.client()
        data = b"%PDF-1.4\nfixture course material\x00\xff"
        body = {"action": "download", "course": 123, "module": 321, "file": 0}
        with (
            patch.object(moodle.Client, "call", side_effect=self.upstream),
            patch.object(moodle, "_request", return_value=(data, "application/pdf")) as request,
        ):
            metadata = moodle.handle(body)
            cached = moodle.handle(body)
        self.assertEqual(metadata, cached)
        self.assertEqual(metadata["name"], "lesson.pdf")
        self.assertEqual(metadata["size"], len(data))
        self.assertEqual(moodle.read_file(metadata["id"]), (data, metadata))
        self.assertEqual(len(list(moodle.DOWNLOADS.iterdir())), 2)
        sent = urllib.parse.urlsplit(request.call_args.args[0].full_url)
        self.assertEqual(urllib.parse.parse_qs(sent.query), {"forcedownload": ["1"], "token": [TOKEN]})
        self.assertNotIn(TOKEN, json.dumps(metadata))
        if os.name != "nt":
            self.assertEqual(moodle.KEY_FILE.stat().st_mode & 0o777, 0o600)
            self.assertEqual(moodle.DOWNLOADS.stat().st_mode & 0o777, 0o700)
            self.assertEqual((moodle.DOWNLOADS / metadata["id"]).stat().st_mode & 0o777, 0o600)

    def test_download_rejects_external_origins_wrong_routes_and_traversal(self):
        client = self.client()
        for url in [
            "https://attacker.invalid/webservice/pluginfile.php/a",
            SITE + "/admin/",
            FILE_URL.replace("https:", "http:"),
            "https://moodle.example.edu.attacker.invalid/webservice/pluginfile.php/a",
            FILE_URL + "?redirect=http://attacker.invalid",
        ]:
            with (
                patch.object(client, "file_entry", return_value={"fileurl": url}),
                patch.object(moodle, "_request") as request,
            ):
                with self.assertRaises(moodle.MoodleError):
                    client.download({})
                request.assert_not_called()
        for fid in ["../moodle_key.txt", "a" * 63, "z" * 64, "a" * 64]:
            with self.assertRaises(moodle.MoodleError):
                moodle.read_file(fid)
        self.assertFalse(moodle.DOWNLOADS.exists())

    def test_download_json_access_error_is_not_saved_as_material(self):
        client = self.client()
        error = json.dumps({"exception": "access", "errorcode": "accessexception", "message": TOKEN}).encode()
        with (
            patch.object(client, "file_entry", return_value={"fileurl": FILE_URL}),
            patch.object(moodle, "_request", return_value=(error, "application/json")),
        ):
            with self.assertRaisesRegex(moodle.MoodleError, "does not permit"):
                client.download({})
        self.assertFalse(moodle.DOWNLOADS.exists())

    def test_private_setup_verifies_before_replacing_existing_token(self):
        moodle.save_token("b" * 32)
        output = io.StringIO()
        with (
            patch.object(moodle_setup.sys.stdin, "isatty", return_value=True),
            patch("builtins.input", return_value="student"),
            patch.object(moodle_setup.getpass, "getpass", return_value=PASSWORD),
            patch.object(moodle, "login", return_value=TOKEN),
            patch.object(moodle.Client, "info", side_effect=moodle.MoodleError("Cannot verify account")),
            redirect_stderr(output),
        ):
            self.assertEqual(moodle_setup.main([]), 1)
        self.assertEqual(moodle.KEY_FILE.read_text().strip(), "b" * 32)
        with (
            patch.object(moodle_setup.sys.stdin, "isatty", return_value=True),
            patch("builtins.input", return_value="student"),
            patch.object(moodle_setup.getpass, "getpass", return_value=PASSWORD),
            patch.object(moodle, "login", return_value=TOKEN),
            patch.object(moodle.Client, "info", return_value=INFO),
            redirect_stdout(output),
        ):
            self.assertEqual(moodle_setup.main([]), 0)
        self.assertEqual(moodle.KEY_FILE.read_text().strip(), TOKEN)
        self.assertNotIn(TOKEN, output.getvalue())
        self.assertNotIn(PASSWORD, output.getvalue())

    def test_setup_requires_private_interactive_terminal_and_token_mode_is_hidden(self):
        output = io.StringIO()
        with (
            patch.object(moodle_setup.sys.stdin, "isatty", return_value=False),
            patch.object(moodle_setup.getpass, "getpass") as prompt,
            redirect_stderr(output),
        ):
            self.assertEqual(moodle_setup.main([]), 1)
            prompt.assert_not_called()
        with (
            patch.object(moodle_setup.sys.stdin, "isatty", return_value=True),
            patch.object(moodle_setup.getpass, "getpass", return_value=TOKEN) as prompt,
            patch.object(moodle.Client, "info", return_value=INFO),
            redirect_stdout(output),
        ):
            self.assertEqual(moodle_setup.main(["--token"]), 0)
            prompt.assert_called_once()
        self.assertNotIn(TOKEN, output.getvalue())
        with patch.object(
            moodle_setup.getpass, "getpass", side_effect=moodle_setup.getpass.GetPassWarning("echo unavailable")
        ):
            with self.assertRaisesRegex(moodle.MoodleError, "cannot hide"):
                moodle_setup.hidden("Secret: ")


class MoodleHTTPTests(unittest.TestCase):
    """Exercise the actual request handler with isolated storage and a fake Moodle handler."""

    def setUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.root = Path(
            self.stack.enter_context(
                tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parent, ignore_cleanup_errors=True)
            )
        )
        self.stack.enter_context(
            patch.dict(
                os.environ,
                {
                    "SOS_TOKEN": "toybox-test-only",
                    "SOS_DB": str(self.root / "sos.db"),
                    "SOS_FILES": str(self.root / "public"),
                    "SOS_WWW": str(self.root / "www"),
                },
            )
        )
        import app_changes

        self.stack.enter_context(patch.object(app_changes, "recover"))
        self.stack.enter_context(patch.object(moodle, "DOWNLOADS", self.root / "private"))
        spec = importlib.util.spec_from_file_location("moodle_test_http_server", Path(__file__).with_name("server.py"))
        self.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.module)
        self.fake = self.stack.enter_context(
            patch.dict(self.module.AI_JSON, {"/api/moodle": lambda body: {"connected": False}})
        )
        self.http = self.module.ThreadingHTTPServer(("127.0.0.1", 0), self.module.H)
        thread = threading.Thread(target=self.http.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(self.stop, thread)
        self.url = "http://127.0.0.1:" + str(self.http.server_address[1])

    def stop(self, thread):
        self.http.shutdown()
        self.http.server_close()
        thread.join(timeout=5)

    def request(self, path, token=None, body=None):
        headers = {"Authorization": "Bearer " + token} if token else {}
        request = urllib.request.Request(
            self.url + path, data=json.dumps(body).encode() if body is not None else None, headers=headers
        )
        try:
            return urllib.request.urlopen(request, timeout=5)
        except urllib.error.HTTPError as error:
            return error

    def test_json_requires_sync_bearer_and_disables_caching(self):
        for token in [None, "wrong"]:
            with self.request("/api/moodle", token, {"action": "status"}) as response:
                self.assertEqual(response.code, 401)
        with self.request("/api/moodle", "toybox-test-only", {"action": "status"}) as response:
            self.assertEqual(response.code, 200)
            self.assertEqual(response.headers["Cache-Control"], "no-store")
            self.assertEqual(json.load(response), {"connected": False})

    def test_download_authentication_bytes_and_no_public_attachment_route(self):
        fid = "c" * 64
        moodle.DOWNLOADS.mkdir()
        (moodle.DOWNLOADS / fid).write_bytes(b"private material")
        (moodle.DOWNLOADS / (fid + ".json")).write_text(
            json.dumps({"name": 'lesson "one".pdf', "type": "application/pdf"})
        )
        with self.request("/api/moodle/file/" + fid) as response:
            self.assertEqual(response.code, 401)
        with self.request("/api/moodle/file/" + fid, "toybox-test-only") as response:
            self.assertEqual(response.code, 200)
            self.assertEqual(response.read(), b"private material")
            self.assertEqual(response.headers["Cache-Control"], "no-store")
            self.assertTrue(response.headers["Content-Disposition"].startswith("attachment;"))
        with self.request("/api/file/" + fid) as response:
            self.assertEqual(response.code, 404)


class MoodleDeployTests(unittest.TestCase):
    def snapshot(self, entries):
        buffer = io.BytesIO()
        with tarfile.open(fileobj=buffer, mode="w") as snapshot:
            for name, content in entries.items():
                member = tarfile.TarInfo(name)
                if content is None:
                    member.type = tarfile.SYMTYPE
                    member.linkname = "../moodle_key.txt"
                    snapshot.addfile(member)
                else:
                    member.size = len(content)
                    snapshot.addfile(member, io.BytesIO(content))
        buffer.seek(0)
        return tarfile.open(fileobj=buffer, mode="r")

    def test_old_deployer_bootstrap_installs_only_fixed_runtime_files(self):
        from setup_changes import install_moodle_runtime

        entries = {"runtime/" + name: name.encode() for name in ("moodle.py", "moodle_setup.py", "MOODLE.md")}
        entries["runtime/unrequested.py"] = b"not installed"
        with (
            tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parent) as folder,
            self.snapshot(entries) as snapshot,
        ):
            root = Path(folder)
            install_moodle_runtime(snapshot, root)
            self.assertEqual(sorted(p.name for p in root.iterdir()), ["MOODLE.md", "moodle.py", "moodle_setup.py"])
            self.assertEqual((root / "moodle.py").read_bytes(), b"moodle.py")

    def test_bootstrap_rejects_links_and_partial_snapshots_before_writing(self):
        from setup_changes import install_moodle_runtime

        for entries in [
            {"runtime/moodle.py": b"one"},
            {"runtime/moodle.py": None, "runtime/moodle_setup.py": b"setup", "runtime/MOODLE.md": b"docs"},
        ]:
            with (
                tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parent) as folder,
                self.snapshot(entries) as snapshot,
            ):
                with self.assertRaises(ValueError):
                    install_moodle_runtime(snapshot, Path(folder))
                self.assertEqual(list(Path(folder).iterdir()), [])
        with tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parent) as folder, self.snapshot({}) as snapshot:
            install_moodle_runtime(snapshot, Path(folder))
            self.assertEqual(list(Path(folder).iterdir()), [])


if __name__ == "__main__":
    unittest.main()
