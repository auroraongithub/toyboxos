"""Messages protocol regression tests: local HTTP only, no real keys or providers."""

from contextlib import ExitStack
import io
import json
from pathlib import Path
import sqlite3
import tempfile
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest.mock import patch

import ai
import ai_messages
import agent
import app_changes
import pull_jobs


MODEL = "msgs:msg-model-1"
TOKENS = {"input_tokens": 40, "cache_read_input_tokens": 100, "cache_creation_input_tokens": 20, "output_tokens": 0}


def events(*values):
    return io.BytesIO(
        b"".join(b"event: " + v["type"].encode() + b"\r\ndata: " + json.dumps(v).encode() + b"\r\n\r\n" for v in values)
    )


def reply(text="Hello.", tools=False):
    values = [{"type": "message_start", "message": {"usage": TOKENS}}]
    values += [
        {"type": "ping"},
        {"type": "content_block_start", "index": 0, "content_block": {"type": "text", "text": ""}},
        {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": text}},
        {"type": "content_block_stop", "index": 0},
    ]
    if tools:
        for index, q in [(1, "algebra"), (3, "geometry")]:
            args = json.dumps({"q": q, "where": "notes"})
            values += [
                {
                    "type": "content_block_start",
                    "index": index,
                    "content_block": {"type": "tool_use", "id": "tool_" + str(index), "name": "search", "input": {}},
                },
                {
                    "type": "content_block_delta",
                    "index": index,
                    "delta": {"type": "input_json_delta", "partial_json": args[:5]},
                },
                {
                    "type": "content_block_delta",
                    "index": index,
                    "delta": {"type": "input_json_delta", "partial_json": args[5:]},
                },
                {"type": "content_block_stop", "index": index},
            ]
    values += [
        {
            "type": "message_delta",
            "delta": {"stop_reason": "tool_use" if tools else "end_turn"},
            "usage": {"output_tokens": 12},
        },
        {"type": "message_stop"},
    ]
    return events(*values).getvalue()


class MessagesModel(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        self.server.seen.append((self.path, dict(self.headers), body))
        result = self.server.replies.pop(0)
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream" if body.get("stream") else "application/json")
        self.end_headers()
        self.wfile.write(result if isinstance(result, bytes) else json.dumps(result).encode())


class ClosingConnection(sqlite3.Connection):
    def __exit__(self, *args):
        try:
            return super().__exit__(*args)
        finally:
            self.close()


class MessagesTests(unittest.TestCase):
    def setUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        temp = self.stack.enter_context(
            tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parent, ignore_cleanup_errors=True)
        )
        db = str(Path(temp) / "test.db")
        self.conn = lambda: sqlite3.connect(db, timeout=10, factory=ClosingConnection)
        self.stack.enter_context(patch.object(ai, "_conn", None))
        self.stack.enter_context(patch.object(agent, "_conn", None))
        ai.init(self.conn)
        agent.init(self.conn)
        with self.conn() as conn:
            conn.execute(
                "CREATE TABLE docs(c TEXT, id TEXT, data TEXT, u INTEGER, d INTEGER, seq INTEGER, PRIMARY KEY(c,id))"
            )
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), MessagesModel)
        self.server.seen, self.server.replies = [], []
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.stack.callback(self.server.server_close)
        self.stack.callback(self.server.shutdown)
        config = {
            "default": MODEL,
            "chain": [],
            "max_tokens": 4000,
            "providers": {
                "msgs": {
                    "url": "http://127.0.0.1:%d/v1/messages" % self.server.server_port,
                    "protocol": "anthropic",
                    "cap_usd": 3.0,
                    "models": {"msg-model-1": {"price": [0.024, 0.12, 0.0024], "context": 200000}},
                }
            },
        }
        self.stack.enter_context(patch.object(ai, "cfg", return_value=config))
        self.stack.enter_context(patch.object(ai, "key", return_value="test-key"))

    def stream(self, data):
        response = io.BytesIO(data)
        result = list(ai.lines(response, MODEL, "msg-model-1"))
        self.assertTrue(response.closed)
        return [
            json.loads(line[6:]) for line in result if line.startswith(b"data: ") and line.strip() != b"data: [DONE]"
        ]

    def body(self, **extra):
        return {
            "model": "msg-model-1",
            "max_tokens": 100,
            "messages": [{"role": "system", "content": "You are Osage."}, {"role": "user", "content": "Hello"}],
            **extra,
        }

    def test_request_uses_messages_api(self):
        self.server.replies = [reply()]
        response, model, mid = ai.connect({"model": MODEL, "messages": self.body()["messages"]})
        result = list(ai.lines(response, model, mid))
        path, headers, body = self.server.seen[0]
        self.assertEqual(path, "/v1/messages")
        self.assertEqual(headers["Anthropic-Version"], "2023-06-01")
        self.assertEqual(headers["X-Api-Key"], "test-key")
        self.assertEqual(headers["User-Agent"], "toybox-os/1.0")
        self.assertNotIn("X-App", headers)
        self.assertEqual(body["system"][0]["text"], "You are Osage.")
        self.assertNotIn("stream_options", body)
        self.assertIn(b"data: [DONE]\n\n", result)

    def test_plain_messages_backend_sends_the_app_identity(self):
        rt = ai.info(MODEL)
        request = ai.request(rt, self.body())
        self.assertEqual(request.get_header("User-agent"), "toybox-os/1.0")
        self.assertNotIn("X-app", request.headers)
        self.assertEqual(json.loads(request.data)["system"][0]["text"], "You are Osage.")

    def test_system_image_tools_and_parallel_results_round_trip(self):
        messages = self.body()["messages"] + [
            {
                "role": "assistant",
                "content": None,
                "tool_calls": [
                    {"id": "a", "function": {"name": "look", "arguments": "{}"}},
                    {"id": "b", "function": {"name": "search", "arguments": '{"q":"math"}'}},
                ],
            },
            {"role": "tool", "tool_call_id": "a", "content": "screen"},
            {"role": "tool", "tool_call_id": "b", "content": "notes"},
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": "Read this"},
                    {"type": "image_url", "image_url": {"url": "data:image/png;base64,AA=="}},
                ],
            },
        ]
        before = json.dumps(messages)
        body = ai_messages.request(self.body(messages=messages, tools=agent.SCHEMAS))
        self.assertEqual(json.dumps(messages), before)
        self.assertEqual([m["role"] for m in body["messages"]], ["user", "assistant", "user"])
        last = body["messages"][-1]["content"]
        self.assertEqual([p["type"] for p in last], ["tool_result", "tool_result", "text", "image"])
        self.assertEqual([p["tool_use_id"] for p in last[:2]], ["a", "b"])
        self.assertEqual(last[-1]["source"], {"type": "base64", "media_type": "image/png", "data": "AA=="})
        self.assertIn("cache_control", last[-1])
        self.assertIn("input_schema", body["tools"][0])

    def test_rejects_invalid_tool_arguments_before_network(self):
        messages = self.body()["messages"] + [
            {
                "role": "assistant",
                "content": "",
                "tool_calls": [{"id": "a", "function": {"name": "look", "arguments": "[]"}}],
            }
        ]
        with self.assertRaises(ai.Upstream) as error:
            ai.connect({"model": MODEL, "messages": messages})
        self.assertEqual(error.exception.code, 400)
        self.assertEqual(self.server.seen, [])

    def test_stream_text_fragmented_parallel_calls_and_finish(self):
        result = self.stream(reply("Looking.", tools=True))
        chunks = [v["choices"][0] for v in result if v.get("choices")]
        self.assertEqual("".join(v["delta"].get("content", "") for v in chunks), "Looking.")
        calls = {}
        for chunk in chunks:
            for call in chunk["delta"].get("tool_calls", []):
                current = calls.setdefault(call["index"], {"id": call.get("id"), "arguments": ""})
                current["arguments"] += call["function"].get("arguments", "")
        self.assertEqual([c["id"] for c in calls.values()], ["tool_1", "tool_3"])
        self.assertEqual([json.loads(c["arguments"])["q"] for c in calls.values()], ["algebra", "geometry"])
        self.assertEqual(chunks[-1]["finish_reason"], "tool_calls")

    def test_cache_creation_reads_output_and_spend_logged_once(self):
        result = self.stream(reply())
        with self.conn() as conn:
            rows = conn.execute("SELECT prompt,cached,completion,cost FROM ai_usage").fetchall()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0][:3], (160, 100, 12))
        self.assertAlmostEqual(rows[0][3], (40 * 0.024 + 20 * 0.024 * 1.25 + 100 * 0.0024 + 12 * 0.12) / 1e6)
        meta = next(v["sos"] for v in result if "sos" in v)
        self.assertEqual((meta["ctx"], meta["cmax"], meta["day"]), (160, 200000, 1))
        self.assertEqual(ai.usage()["cost"], 0)
        self.assertGreater(ai.backend_spend("msgs"), 0)

    def test_one_hour_cache_write_price(self):
        tokens = {**TOKENS, "cache_creation": {"ephemeral_1h_input_tokens": 20}}
        ai._log(MODEL, ai_messages.usage(tokens))
        self.assertAlmostEqual(ai.backend_spend("msgs"), (40 * 0.024 + 20 * 0.024 * 2 + 100 * 0.0024) / 1e6)

    def test_stream_error_and_truncation_are_visible_and_usage_is_kept(self):
        for ending in [[], [{"type": "error", "error": {"message": "overloaded"}}]]:
            with self.subTest(ending=ending):
                result = self.stream(
                    events({"type": "message_start", "message": {"usage": TOKENS}}, *ending).getvalue()
                )
                self.assertIn("error", result[-1])
        with self.conn() as conn:
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM ai_usage").fetchone()[0], 2)

    def test_empty_tool_arguments_and_hidden_thinking(self):
        result = self.stream(
            events(
                {
                    "type": "content_block_start",
                    "index": 0,
                    "content_block": {"type": "thinking", "thinking": "private"},
                },
                {"type": "content_block_delta", "index": 0, "delta": {"type": "thinking_delta", "thinking": "private"}},
                {
                    "type": "content_block_start",
                    "index": 1,
                    "content_block": {"type": "tool_use", "id": "a", "name": "look", "input": {}},
                },
                {"type": "content_block_stop", "index": 1},
                {"type": "message_stop"},
            ).getvalue()
        )
        self.assertNotIn("private", json.dumps(result))
        args = [
            c["function"]["arguments"]
            for v in result
            for ch in v.get("choices", [])
            for c in ch["delta"].get("tool_calls", [])
        ]
        self.assertEqual("".join(args), "{}")

    def test_background_agent_executes_tools_and_resends_results(self):
        self.server.replies = [reply("Checking notes.", tools=True), reply("Checked both topics.")]
        run = agent.start(
            {"chat": "test-chat", "model": MODEL, "messages": self.body()["messages"], "tools": agent.SCHEMAS}
        )
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            status = agent.poll({"id": run["id"]})
            if status["state"] != "running":
                break
            time.sleep(0.02)
        self.assertEqual(status["state"], "done", status)
        self.assertEqual(len(self.server.seen), 2)
        history = self.server.seen[1][2]["messages"]
        self.assertEqual([b["type"] for b in history[-2]["content"]], ["text", "tool_use", "tool_use"])
        self.assertEqual([b["tool_use_id"] for b in history[-1]["content"]], ["tool_1", "tool_3"])
        with self.conn() as conn:
            saved = [json.loads(row[0]) for row in conn.execute("SELECT data FROM docs WHERE c='amsg'")]
        self.assertEqual(sum(m.get("r") == "tool" for m in saved), 2)
        self.assertTrue(any(m.get("t") == "Checked both topics." for m in saved))

    def nonstream(self, text, calls=None):
        content = [{"type": "text", "text": text}]
        if calls:
            content.extend(calls)
        return {
            "content": content,
            "stop_reason": "tool_use" if calls else "end_turn",
            "usage": {**TOKENS, "output_tokens": 12},
        }

    def test_jobs_use_messages_api_and_read_json_reply(self):
        self.server.replies = [self.nonstream('{"fit":75}')]
        self.assertEqual(pull_jobs.complete("Answer JSON only", "Score this job", 200), {"fit": 75})
        self.assertFalse(self.server.seen[0][2]["stream"])
        self.assertNotIn("response_format", self.server.seen[0][2])

    def test_app_drafts_read_native_tool_reply(self):
        self.server.replies = [
            self.nonstream(
                "Reading.",
                [{"type": "tool_use", "id": "read_1", "name": "read_file", "input": {"path": "src/modules/today.js"}}],
            )
        ]
        result = app_changes.complete(self.body()["messages"], {"cost": 0})
        self.assertEqual(result["tool_calls"][0]["id"], "read_1")
        self.assertEqual(json.loads(result["tool_calls"][0]["function"]["arguments"]), {"path": "src/modules/today.js"})

    def test_openai_backend_payload_is_unchanged(self):
        body = self.body(stream=True, stream_options={"include_usage": True})
        rt = {"url": "https://example.invalid/v1/chat/completions", "key": "test", "protocol": "openai"}
        request = ai.request(rt, body)
        self.assertEqual(json.loads(request.data), body)
        self.assertIs(ai.completion(rt, body), body)


if __name__ == "__main__":
    unittest.main()
