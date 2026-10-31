"""Providers and keys: kinds + ai.json, id parsing, availability, spend, the secrets store and the app's settings API."""

import http.server
import json
import os
import sqlite3
import tempfile
import threading
import unittest
from unittest.mock import patch
import ai
import aiconf

MINE = {
    "default": "grok:grok-4.7",
    "chain": ["gemini:gemini-3.5-flash-lite", "deepseek/deepseek-v4.1-flash"],
    "providers": {
        "gemini": {
            "kind": "gemini",
            "models": {
                "gemini-3.5-flash-lite": {"label": "Flash Lite", "free_day": 500},
                "gemma-4-26b-a4b-it": {"extra": {}},
            },
        },
        "openrouter": {"kind": "openrouter", "models": {"deepseek/deepseek-v4.1-flash": {"pin": ["deepseek"]}}},
        "grok": {
            "kind": "custom",
            "label": "Grok",
            "url": "https://grok.test/v1/chat/completions",
            "cap_usd": 3,
            "models": {"grok-4.7": {"price": [0.12, 0.36, 0.03]}},
        },
    },
}


class ProvidersTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        db = os.path.join(self.tmp, "t.db")
        self.over = os.path.join(self.tmp, "ai.json")
        self.p = [
            patch.object(ai, "CFG_FILE", self.over),
            patch.object(ai, "BASE", self.tmp),
            patch.dict(
                os.environ,
                {"GEMINI_API_KEY": "", "OPENROUTER_API_KEY": "", "SOS_SECRETS": os.path.join(self.tmp, "secrets.json")},
            ),
        ]
        for p in self.p:
            p.start()
        ai._sec["m"] = None
        aiconf._lists.clear()
        ai.init(lambda: sqlite3.connect(db))
        self.write(MINE)
        ai.set_secret("gemini", "g")

    def tearDown(self):
        for p in self.p:
            p.stop()

    def write(self, o):
        with open(self.over, "w") as f:
            json.dump(o, f)

    def test_shipped_kinds_are_valid_and_carry_no_models(self):
        shipped = ai._load(ai.CATALOG_FILE)
        self.assertEqual(shipped.get("providers"), {})
        for k, kc in shipped["kinds"].items():
            self.assertNotIn("models", kc, k)
            self.assertIn(kc.get("protocol", "openai"), ("openai", "anthropic"), k)
            self.assertTrue(kc.get("url") or kc.get("needs_url"), k)

    def test_providers_inherit_their_kind(self):
        b = ai.backends()
        self.assertTrue(b["gemini"]["url"].startswith("https://generativelanguage"))
        self.assertTrue(b["openrouter"]["bare_ids"])
        self.assertEqual(b["grok"]["url"], "https://grok.test/v1/chat/completions")

    def test_ids(self):
        self.assertEqual(ai.split("gemini:gemini-flash-latest"), ("gemini", "gemini-flash-latest"))
        self.assertEqual(ai.split("deepseek/deepseek-v4.1-flash"), ("openrouter", "deepseek/deepseek-v4.1-flash"))
        self.assertEqual(ai.full_id("grok", "grok-4.7"), "grok:grok-4.7")

    def test_why_not_and_fallback(self):
        self.assertIsNone(ai.why_not("gemini:gemini-3.5-flash-lite"))
        self.assertEqual(ai.why_not("grok:grok-4.7"), "no key")
        self.assertEqual(ai.why_not("nope:x"), "not set up")
        self.assertEqual(
            ai.candidates("grok:grok-4.7")[0], "gemini:gemini-3.5-flash-lite"
        )  # no Grok key: the chain takes over
        self.assertEqual(ai.resolve("made-up"), "grok:grok-4.7")
        self.write({**MINE, "default": "gone:x"})
        self.assertEqual(
            ai.resolve(""), "gemini:gemini-3.5-flash-lite"
        )  # a missing default falls to the first usable model

    def test_cap_and_price_per_provider(self):
        ai.set_secret("grok", "k")
        ai._log("grok:grok-4.7", {"prompt_tokens": 1_000_000, "completion_tokens": 0})
        self.assertAlmostEqual(ai.spend("grok"), 0.12)
        self.assertEqual(ai.spend("gemini"), 0)
        self.write({**MINE, "providers": {**MINE["providers"], "grok": {**MINE["providers"]["grok"], "cap_usd": 0.1}}})
        self.assertEqual(ai.why_not("grok:grok-4.7"), "monthly cap reached")

    def test_prepare_adds_provider_bits(self):
        rt = ai.info("gemini:gemini-3.5-flash-lite")
        b = ai.prepare(rt, {"model": rt["mid"], "messages": [], "stream": True})
        self.assertEqual(b["reasoning_effort"], "low")
        g = ai.info("gemini:gemma-4-26b-a4b-it")
        self.assertNotIn("reasoning_effort", ai.prepare(g, {"model": g["mid"], "messages": []}))
        o = ai.info("deepseek/deepseek-v4.1-flash")
        self.assertEqual(ai.prepare(o, {"model": o["mid"], "messages": []})["provider"]["order"], ["deepseek"])

    # ---------- keys ----------
    def test_secrets_file_is_private_and_old_key_files_move_in(self):
        f = os.environ["SOS_SECRETS"]
        if os.name == "posix":
            self.assertEqual(os.stat(f).st_mode & 0o777, 0o600)
        with open(os.path.join(self.tmp, "openrouter_key.txt"), "w") as fh:
            fh.write("or-key\n")
        ai.import_key_files()
        self.assertFalse(os.path.exists(os.path.join(self.tmp, "openrouter_key.txt")))
        self.assertEqual(ai.key("openrouter"), "or-key")
        ai.set_secret("openrouter", "")
        self.assertEqual(ai.key("openrouter"), "")

    def test_settings_never_return_keys(self):
        ai.set_secret("grok", "very-secret-value")
        out = json.dumps(aiconf.setup()) + json.dumps(aiconf.set_key({"provider": "grok", "key": "another-secret"}))
        self.assertNotIn("secret-value", out)
        self.assertNotIn("another-secret", out)
        self.assertTrue({p["id"]: p for p in aiconf.setup()["providers"]}["grok"]["ready"])
        with self.assertRaises(ValueError):
            aiconf.set_key({"provider": "grok", "key": "two words"})

    # ---------- the app's settings API ----------
    def test_add_list_enable_default_remove(self):
        rows = {
            "data": [
                {
                    "id": "acme/big",
                    "name": "Acme Big",
                    "context_length": 128000,
                    "pricing": {"prompt": "0.000001", "completion": "0.000002"},
                    "architecture": {"input_modalities": ["text", "image"]},
                },
                {"id": "models/small-1"},
                {"id": "text-embedding-3"},
            ]
        }
        seen = {}

        class F(http.server.BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def do_GET(self):
                seen["path"], seen["auth"] = self.path, self.headers.get("Authorization")
                b = json.dumps(rows).encode()
                self.send_response(200)
                self.send_header("Content-Length", str(len(b)))
                self.end_headers()
                self.wfile.write(b)

        srv = http.server.HTTPServer(("127.0.0.1", 0), F)
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        try:
            with self.assertRaises(ValueError):
                aiconf.provider({"kind": "custom", "label": "Acme"})  # needs an address
            out = aiconf.provider(
                {"kind": "custom", "label": "Acme AI", "url": "http://127.0.0.1:%d/v1" % srv.server_address[1]}
            )
            pid = out["id"]
            self.assertEqual(pid, "acme-ai")
            self.assertTrue(ai.backends()[pid]["url"].endswith("/v1/chat/completions"))
            with self.assertRaises(ValueError):
                aiconf.live({"provider": pid})  # no key yet
            aiconf.set_key({"provider": pid, "key": "sk-test"})
            ms = aiconf.live({"provider": pid})["models"]
            self.assertEqual(seen, {"path": "/v1/models", "auth": "Bearer sk-test"})
            self.assertEqual(
                [m["id"] for m in ms], ["acme/big", "small-1"]
            )  # embeddings left out, models/ prefix dropped
            self.assertEqual(
                ms[0], {"id": "acme/big", "label": "Acme Big", "context": 128000, "price": [1.0, 2.0], "vision": True}
            )
            aiconf.enable({"provider": pid, "on": [{"id": "acme/big"}]})
            self.assertEqual(ai.model_cfg(pid + ":acme/big")["context"], 128000)
            aiconf.defaults({"default": pid + ":acme/big", "utility": pid + ":acme/big"})
            self.assertEqual(ai.resolve(""), pid + ":acme/big")
            with self.assertRaises(ValueError):
                aiconf.defaults({"default": pid + ":nope"})
            aiconf.provider({"id": pid, "remove": True})
            self.assertNotIn(pid, ai.backends())
            self.assertEqual(ai.secrets().get(pid), None)
            self.assertNotEqual(ai.cfg().get("default"), pid + ":acme/big")
        finally:
            srv.shutdown()


if __name__ == "__main__":
    unittest.main()
