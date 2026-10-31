"""Background runs (agent.py) against a scripted OpenAI-style model and a fake Moodle: no network, no real keys."""

import io
import json
import os
import sqlite3
import sys
import tempfile
import threading
import time
import unittest
import zipfile
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from unittest.mock import patch

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ai
import agent
import moodle


def pptx(*slides):
    b = io.BytesIO()
    with zipfile.ZipFile(b, "w") as z:
        for i, s in enumerate(slides, 1):
            z.writestr("ppt/slides/slide%d.xml" % i, "<p:sld><a:p><a:r><a:t>%s</a:t></a:r></a:p></p:sld>" % s)
    return b.getvalue()


COURSES = [
    {"id": 2515, "shortname": "Math 2171", "fullname": "4-317 Differential Calculus 1st Sem 2026 Vidal"},
    {"id": 3289, "shortname": "CS 3144", "fullname": "CS 3144 Human Computer Interaction (HCI)"},
]
CONTENTS = [
    {
        "name": "Chapter 3",
        "modules": [
            {
                "id": 32,
                "modname": "resource",
                "name": "3.2 The Derivative as a Function",
                "contents": [{"type": "file", "filename": "3.2.pdf"}],
            },
            {
                "id": 33,
                "modname": "resource",
                "name": "3.3 Differentiation Rules",
                "contents": [{"type": "file", "filename": "3.3.pptx"}],
            },
            {"id": 34, "modname": "assign", "name": "Seatwork", "contents": []},
        ],
    }
]
FILES = {32: ("3.2.pdf", b"%PDF fake"), 33: ("3.3.pptx", pptx("Power rule", "Product rule"))}


def fake_handle(b):
    a = b["action"]
    if a == "courses":
        return COURSES
    if a == "contents":
        return CONTENTS
    if a == "download":
        n, data = FILES[b["module"]]
        return {"id": ("%064x" % b["module"]), "name": n, "size": len(data), "type": "x"}
    raise moodle.MoodleError("unexpected " + a)


def fake_read(fid):
    n, data = FILES[int(fid, 16)]
    return data, {"name": n}


def call(i, name, args, x=None):
    d = {"index": i, "id": "c%s%d" % (name, i), "function": {"name": name, "arguments": json.dumps(args)}}
    if x:
        d["extra_content"] = x
    return d


SIG = {"google": {"thought_signature": "sig-1"}}
SCRIPT = [
    {"tool_calls": [call(0, "moodle", {"do": "course", "course": "diff"}, SIG)]},
    {
        "tool_calls": [
            call(0, "write_page", {"title": "Differential Calculus", "body": "", "mode": "new", "kind": "subject"})
        ]
    },
    # Gemini style: parallel calls, each complete, both at index 0
    {
        "tool_calls": [
            call(0, "moodle", {"do": "save", "course": "2515", "module": 32, "under": "Differential Calculus"}),
            {
                **call(0, "moodle", {"do": "save", "course": "2515", "module": 33, "under": "Differential Calculus"}),
                "id": "csecond",
            },
        ]
    },
    {"tool_calls": [call(0, "show", {"page": "Differential Calculus"})]},
    {"content": "Saved 3.2 and 3.3 under Differential Calculus."},
]


class Model(BaseHTTPRequestHandler):
    seen = []

    def log_message(self, *a):
        pass

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        Model.seen.append(body)
        step = SCRIPT[len(Model.seen) - 1]
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.end_headers()
        chunks = (
            [
                {"choices": [{"delta": {"content": step["content"][:10]}}]},
                {"choices": [{"delta": {"content": step["content"][10:]}}]},
            ]
            if "content" in step
            else [{"choices": [{"delta": {"tool_calls": step["tool_calls"]}}]}]
        )
        for c in chunks + [
            {"choices": [{"delta": {}, "finish_reason": "stop"}], "usage": {"prompt_tokens": 5, "completion_tokens": 3}}
        ]:
            self.wfile.write(b"data: " + json.dumps(c).encode() + b"\n\n")
        self.wfile.write(b"data: [DONE]\n\n")


class AgentTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        db = os.path.join(self.tmp, "t.db")

        def conn():
            c = sqlite3.connect(db, timeout=10)
            return c

        with conn() as c:
            c.execute(
                "CREATE TABLE IF NOT EXISTS docs(c TEXT, id TEXT, data TEXT, u INTEGER, d INTEGER, seq INTEGER, PRIMARY KEY(c,id))"
            )
        ai.init(conn)
        agent.init(conn)
        self.conn = conn
        self.srv = ThreadingHTTPServer(("127.0.0.1", 0), Model)
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()
        Model.seen = []
        self.p = [
            patch.object(ai, "UPSTREAM", "http://127.0.0.1:%d/v1/chat/completions" % self.srv.server_port),
            patch.object(ai, "CFG_FILE", os.path.join(self.tmp, "none.json")),
            patch.dict(
                os.environ,
                {
                    "OPENROUTER_API_KEY": "test",
                    "GEMINI_API_KEY": "",
                    "MISTRAL_API_KEY": "",
                    "CEREBRAS_API_KEY": "",
                    "GROQ_API_KEY": "",
                },
            ),
            patch.object(ai, "key", lambda be="openrouter": "test" if be == "openrouter" else ""),
            patch.object(moodle, "handle", fake_handle),
            patch.object(moodle, "read_file", fake_read),
            patch.object(ai, "_pdf_text", lambda data: "[p.1]\nDerivative of x^2 is 2x\n[p.2]\nLimits again"),
        ]
        for p in self.p:
            p.start()
        with open(ai.CFG_FILE, "w") as f:  # one OpenRouter model, answered by the scripted model above
            json.dump(
                {
                    "default": "test/model",
                    "providers": {"openrouter": {"kind": "openrouter", "models": {"test/model": {}}}},
                },
                f,
            )

    def tearDown(self):
        for p in self.p:
            p.stop()
        self.srv.shutdown()

    def wait(self, run_id, until):
        end = time.time() + 15
        while time.time() < end:
            v = agent.poll({"id": run_id})
            if until(v):
                return v
            time.sleep(0.05)
        self.fail("run never reached the state: %s" % agent.poll({"id": run_id}))

    def test_diffcal_request_runs_to_the_end_on_the_server(self):
        v = agent.start(
            {
                "chat": "chat1",
                "messages": [
                    {"role": "system", "content": "sys"},
                    {"role": "user", "content": "get 3.2, 3.3 in diffcal into notes under diffcal"},
                ],
                "tools": agent.SCHEMAS,
            }
        )
        # the app-only tool (show) waits for an app, which answers it
        p = self.wait(v["id"], lambda x: x["pending"])["pending"]
        self.assertEqual(p["n"], "show")
        agent.result({"id": v["id"], "call": p["id"], "t": "Opened Differential Calculus.", "ok": True})
        end = self.wait(v["id"], lambda x: x["state"] != "running")
        self.assertEqual(end["state"], "done", end)

        pages = {p["_id"]: p for p in agent._all("pages")}
        subj = next(p for p in pages.values() if p["kind"] == "subject")
        self.assertEqual(subj["title"], "Differential Calculus")
        self.assertEqual(subj["props"], [["Course code", ""], ["Teacher", ""], ["Schedule", ""]])
        saved = [p for p in pages.values() if p.get("doc")]
        self.assertEqual(
            sorted(p["title"] for p in saved), ["3.2 The Derivative as a Function", "3.3 Differentiation Rules"]
        )
        for p in saved:
            self.assertEqual(p["parent"], subj["_id"])
            self.assertTrue(p["_id"].startswith("mdl-"))
            self.assertEqual(p["props"], [["Course", "4-317 Differential Calculus 1st Sem 2026 Vidal"]])
        pdf = next(p for p in saved if p["doc"]["type"] == "pdf")
        ppt = next(p for p in saved if p["doc"]["type"] == "pptx")
        self.assertEqual(pdf["doc"]["pages"], 2)
        self.assertIn("2x", pdf["body"])
        self.assertEqual(ppt["body"], "[slide 1]\nPower rule\n\n[slide 2]\nProduct rule")

        msgs = sorted(agent._all("amsg"), key=lambda m: m["o"])
        self.assertTrue(all(m["c"] == "chat1" for m in msgs))
        self.assertEqual(
            [m["r"] for m in msgs],
            ["assistant", "tool", "assistant", "tool", "assistant", "tool", "tool", "assistant", "tool", "assistant"],
        )
        self.assertEqual(msgs[0]["tc"][0]["x"], SIG)  # Gemini signature kept for the app's later turns
        self.assertIn("[32] resource: 3.2 The Derivative", msgs[1]["t"])
        self.assertEqual(msgs[-1]["t"], "Saved 3.2 and 3.3 under Differential Calculus.")
        self.assertEqual(msgs[-2]["t"], "Opened Differential Calculus.")
        # each request re-sends the signature verbatim and every tool result so far
        self.assertEqual(Model.seen[1]["messages"][2]["tool_calls"][0]["extra_content"], SIG)
        self.assertEqual([m["role"] for m in Model.seen[-1]["messages"]][-2:], ["assistant", "tool"])

        self.assertEqual(
            agent.write_page({"title": "differential calculus", "body": "", "kind": "subject"})[0],
            'Subject "Differential Calculus" already exists (id %s); file pages under it.' % subj["_id"],
        )
        again = agent.Moodle().run({"do": "save", "course": "diff", "module": 33})
        self.assertEqual(again, ('Already in Notes as "3.3 Differentiation Rules".', True))

    def test_unknown_subject_is_reported_and_a_missing_app_fails_only_that_step(self):
        global SCRIPT
        old = SCRIPT
        SCRIPT = [
            {
                "tool_calls": [
                    call(0, "moodle", {"do": "save", "course": "diff", "module": 32, "under": "Nope"}),
                    call(1, "look", {}),
                ]
            },
            {"content": "Couldn't finish."},
        ]
        try:
            with patch.object(agent, "WAIT_APP", 0.2):
                v = agent.start({"text": "save 3.2"})
                end = self.wait(v["id"], lambda x: x["state"] != "running")
        finally:
            SCRIPT = old
        self.assertEqual(end["state"], "done")
        tools = sorted((m for m in agent._all("amsg") if m["r"] == "tool"), key=lambda m: m["o"])
        self.assertIn('No page called "Nope"', tools[0]["t"])
        self.assertFalse(tools[0]["ok"])
        self.assertIn("app wasn't open", tools[1]["t"])
        self.assertTrue(agent._get("chats", end["chat"]))  # a script-started run gets its own chat
        self.assertEqual(sorted(agent._all("amsg"), key=lambda m: m["o"])[0]["r"], "user")

    def test_stop_ends_a_run_waiting_for_the_app(self):
        global SCRIPT
        old = SCRIPT
        SCRIPT = [{"tool_calls": [call(0, "look", {})]}]
        try:
            v = agent.start({"chat": "c2", "messages": [{"role": "user", "content": "look"}]})
            self.wait(v["id"], lambda x: x["pending"])
            agent.stop({"id": v["id"]})
            end = self.wait(v["id"], lambda x: x["state"] != "running")
        finally:
            SCRIPT = old
        self.assertEqual(end["state"], "stopped")
        with self.assertRaises(ValueError):
            agent.start({"chat": "c2", "messages": [{"role": "user", "content": "x"}]}) if agent._active("c2") else (
                _ for _ in ()
            ).throw(ValueError())

    def test_ask_ends_the_run_with_a_question_and_choices(self):
        global SCRIPT
        old = SCRIPT
        SCRIPT = [
            {
                "tool_calls": [
                    call(
                        0,
                        "ask",
                        {
                            "question": "Files or a summary?",
                            "options": ["The files", "A summary", "Both", "", "x", "y"],
                        },
                    )
                ]
            }
        ]
        try:
            v = agent.start({"chat": "c3", "messages": [{"role": "user", "content": "put 3.2 in notes"}]})
            end = self.wait(v["id"], lambda x: x["state"] != "running")
        finally:
            SCRIPT = old
        self.assertEqual(end["state"], "done")
        self.assertEqual(len(Model.seen), 1)  # no second model call
        ms = sorted(agent._all("amsg"), key=lambda m: m["o"])
        self.assertEqual([m["r"] for m in ms], ["assistant", "tool", "assistant"])
        self.assertEqual((ms[-1]["t"], ms[-1]["ask"]), ("Files or a summary?", ["The files", "A summary", "Both", "x"]))

    def test_extract_handles_docx_and_refuses_unknown(self):
        b = io.BytesIO()
        with zipfile.ZipFile(b, "w") as z:
            z.writestr(
                "word/document.xml",
                "<w:document><w:p><w:t>Limits &amp; continuity</w:t></w:p><w:p><w:t>Next</w:t></w:p></w:document>",
            )
        self.assertEqual(agent.extract("a.docx", b.getvalue()), ("Limits & continuity\nNext", 0))
        with self.assertRaises(ValueError):
            agent.extract("a.xlsx", b"")


if __name__ == "__main__":
    unittest.main()
