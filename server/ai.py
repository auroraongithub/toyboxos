"""toybox.os study buddy, server side (stdlib only).
- /api/ai: streams chat completions from any provider in providers.json (OpenAI-compatible or Anthropic Messages).
  A model is "<provider>:<model>" (OpenRouter's own "vendor/model" ids work bare). Keys live here (<provider>_key.txt or the
  provider's key_env), never in the app. Logs token use, estimates cost from catalogue prices when the provider sends none,
  and skips a provider once its monthly cap_usd is spent. See PROVIDERS.md.
- /api/src*: NotebookLM-style sources. Text from a link, a PDF, a YouTube transcript or pasted text is cut into
  ~1200-char chunks in an SQLite full-text index, so the assistant searches and reads only the parts it needs."""

import json
import os
import re
import time
import socket
import urllib.parse
import ipaddress
import subprocess
import tempfile
import http.client
import urllib.request
import urllib.error
import html as htmllib
from html.parser import HTMLParser
import ai_messages

HERE = os.path.dirname(os.path.abspath(__file__))
BASE = os.environ.get("SOS_HOME") or HERE  # data folder (the packaged server keeps it apart from the code)
CFG_FILE = os.environ.get("SOS_AI_CFG") or os.path.join(
    BASE, "ai.json"
)  # your overrides (same shape as providers.json), never committed
CATALOG_FILE = os.path.join(HERE, "providers.json")  # shipped defaults
UPSTREAM = os.environ.get("SOS_AI_URL")  # tests point OpenRouter at a mock
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36"
CHUNK = 1200
MAXTEXT = 3_000_000


# ---------- catalogue ----------
def _load(path):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def _merge(base, over):
    """ai.json over providers.json: top-level keys replace; providers and their models merge field by field; null removes."""
    out = dict(base)
    for k, v in over.items():
        if k != "providers":
            out[k] = v
            continue
        provs = {p: dict(c) for p, c in (base.get("providers") or {}).items()}
        for p, c in (v or {}).items():
            if c is None:
                provs.pop(p, None)
                continue
            cur = provs.get(p, {})
            models = dict(cur.get("models") or {})
            for m, mc in (c.get("models") or {}).items():
                if mc is None:
                    models.pop(m, None)
                else:
                    models[m] = {**models.get(m, {}), **mc}
            provs[p] = {**cur, **{a: b for a, b in c.items() if a != "models"}, "models": models}
        out["providers"] = provs
    return out


def cfg():
    return _merge(_load(CATALOG_FILE), _load(CFG_FILE))


def kinds():
    """Provider types the app can add (providers.json "kinds"): connection details only, no models."""
    return _load(CATALOG_FILE).get("kinds") or {}


def backends():
    """{provider id: provider config}: your providers (ai.json, added from the app) over their kind's defaults."""
    ks = kinds()
    out = {}
    for p, c in (cfg().get("providers") or {}).items():
        k = ks.get(c.get("kind") or p) or {}
        out[p] = {**{a: b for a, b in k.items() if a not in ("label_hint", "needs_url")}, **c}
    return out


# ---------- keys: one owner-only file, write-only from the app ----------
def _secrets_file():
    return os.environ.get("SOS_SECRETS") or os.path.join(BASE, "secrets.json")


_sec = {"m": None, "v": {}}


def secrets():
    f = _secrets_file()
    try:
        m = os.stat(f).st_mtime_ns
    except OSError:
        return {}
    if _sec["m"] != m:
        try:
            _sec["v"] = _load(f).get("keys") or {}
            _sec["m"] = m
        except AttributeError:
            _sec["v"] = {}
    return dict(_sec["v"])


def set_secret(name, value):
    """Stores (or with an empty value removes) one key. The file is created 0600 and replaced atomically; nothing ever reads it back out."""
    keys = secrets()
    if value:
        keys[name] = value
    else:
        keys.pop(name, None)
    f = _secrets_file()
    tmp = f + ".tmp"
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as fh:
        json.dump({"keys": keys}, fh)
    os.replace(tmp, f)
    try:
        os.chmod(f, 0o600)
    except OSError:
        pass
    _sec["m"] = None


def import_key_files():
    """Moves old <provider>_key.txt files (and brave_key.txt) into secrets.json, then deletes them."""
    names = set(backends()) | set(kinds()) | {"brave"}
    for n in sorted(names):
        f = os.path.join(BASE, n + "_key.txt")
        if not os.path.isfile(f):
            continue
        try:
            with open(f) as fh:
                k = fh.read().strip()
            if k and not secrets().get(n):
                set_secret(n, k)
            if not k or secrets().get(n) == k:
                os.remove(f)
        except OSError:
            pass


def secret(name, env=""):
    return secrets().get(name) or (os.environ.get(env, "") if env else "")


def split(model):
    """ "gemini:gemini-flash-latest" -> ("gemini", "gemini-flash-latest"); a bare "vendor/model" -> the provider with bare_ids (OpenRouter)."""
    model = str(model or "")
    be, _, m = model.partition(":")
    provs = backends()
    if m and be in provs:
        return be, m
    return next((p for p, c in provs.items() if c.get("bare_ids")), "openrouter"), model


def full_id(provider, mid):
    return mid if (backends().get(provider) or {}).get("bare_ids") else provider + ":" + mid


def model_cfg(model):
    be, mid = split(model)
    return ((backends().get(be) or {}).get("models") or {}).get(mid)


def models():
    """Every model you turned on, in provider order."""
    return [
        full_id(p, m)
        for p, c in backends().items()
        for m, mc in (c.get("models") or {}).items()
        if not (mc or {}).get("hidden")
    ]


def key(backend="openrouter"):
    b = backends().get(backend) or {}
    if b.get("nokey"):
        return secrets().get(backend) or "none"
    k = secret(backend, b.get("key_env") or "")
    if not k:  # an old install that hasn't been migrated yet
        try:
            with open(os.path.join(BASE, backend + "_key.txt")) as f:
                k = f.read().strip()
        except OSError:
            k = ""
    return k


def why_not(model):
    """None if the model can take a request now, else a short reason the app shows."""
    be, _ = split(model)
    prov = backends().get(be)
    if not prov or model_cfg(model) is None:
        return "not set up"
    if not key(be):
        return "no key"
    lim = (model_cfg(model) or {}).get("free_day")
    if lim and day_calls(model) >= lim:
        return "free limit reached today"
    cap = prov.get("cap_usd")
    if cap is not None and spend(be) >= float(cap):
        return "monthly cap reached"
    return None


def usable(model, *_):
    return why_not(model) is None


def resolve(want):
    """The model the app asked for: an exact id, "utility", or empty for the default."""
    c0 = cfg()
    ms = models()
    first = next((m for m in ms if usable(m)), ms[0] if ms else None)
    d = c0.get("default") if c0.get("default") in ms else first
    if want == "utility":
        return c0.get("utility") if c0.get("utility") in ms else d
    return want if want in ms else d


def candidates(want=None):
    """Models to try in order: the asked-for one, then the fallback chain."""
    c0 = cfg()
    seen = []
    for m in [resolve(want)] + list(c0.get("chain") or models()):
        if m and m not in seen and usable(m):
            seen.append(m)
    return seen


def route(want=None):
    """Pick the model to call for one-off jobs (job scoring, app drafts). Raises ValueError("cap") / ("no_key")."""
    todo = candidates(want)
    if not todo:
        if any(key(split(m)[0]) for m in models()):
            raise ValueError("cap")
        raise ValueError("no_key")
    return info(todo[0])


def info(model):
    be, mid = split(model)
    prov = backends().get(be) or {}
    mc = model_cfg(model) or {}
    url = UPSTREAM if prov.get("openrouter") and UPSTREAM else prov.get("url")
    extra = mc["extra"] if "extra" in mc else prov.get("extra") or {}
    return {
        "model": model,
        "be": be,
        "mid": mid,
        "url": url,
        "key": key(be),
        "name": prov.get("label") or be.capitalize(),
        "extra": extra,
        "protocol": prov.get("protocol", "openai"),
        "headers": prov.get("headers") or {},
    }


def prepare(rt, body, think=True):
    """Provider-specific additions to one request body (usage reporting, reasoning, OpenRouter routing, per-model extras).
    Shared by chat, job scoring and app drafts so a new provider only needs its catalogue entry."""
    c0 = cfg()
    prov = backends().get(rt["be"]) or {}
    mc = model_cfg(rt["model"]) or {}
    body = dict(body)
    if mc.get("cache_hints") and body.get("messages"):
        body["messages"] = _cache_hints(body["messages"])
    if prov.get("openrouter"):
        body["usage"] = {"include": True}
        if not think:
            body["reasoning"] = {"enabled": False}
        elif c0.get("reasoning"):
            body["reasoning"] = {"effort": c0["reasoning"], "exclude": True}
        if mc.get("pin"):
            body["provider"] = {"order": mc["pin"], "allow_fallbacks": True}
    else:
        if body.get("stream") and rt.get("protocol", "openai") == "openai":
            body["stream_options"] = {"include_usage": True}
        body.update(rt["extra"])
    return body


def request(rt, body):
    """Build the HTTP request for a provider."""
    headers = {
        "Authorization": "Bearer " + rt["key"],
        "Content-Type": "application/json",
        "User-Agent": "toybox-os/1.0",
        "X-Title": "toybox.os",
        **(rt.get("headers") or {}),
    }
    if rt.get("protocol") == "anthropic":
        body = ai_messages.request(body)
        headers.update({"x-api-key": rt["key"], "anthropic-version": "2023-06-01"})
    return urllib.request.Request(rt["url"], json.dumps(body).encode(), headers)


def completion(rt, value):
    return ai_messages.completion(value) if rt.get("protocol") == "anthropic" else value


def _thinks_inline(model):
    return bool((model_cfg(model) or {}).get("inline_thinking"))  # Gemma streams <thought>...</thought> as text


class _NoThought:
    """Drops <thought>...</thought> from streamed text, including tags split across chunks."""

    def __init__(self):
        self.inside = False
        self.buf = ""
        self.started = False

    def feed(self, t):
        self.buf += t
        out = ""
        while self.buf:
            tag = "</thought>" if self.inside else "<thought>"
            i = self.buf.find(tag)
            if i >= 0:
                if not self.inside:
                    out += self.buf[:i]
                self.buf = self.buf[i + len(tag) :]
                self.inside = not self.inside
                continue
            keep = next((n for n in range(len(tag) - 1, 0, -1) if self.buf.endswith(tag[:n])), 0)  # maybe a split tag
            if not self.inside:
                out += self.buf[: len(self.buf) - keep]
            self.buf = self.buf[len(self.buf) - keep :] if keep else ""
            break
        if not self.started:  # no blank lines left over at the start of the reply
            out = out.lstrip()
            self.started = bool(out)
        return out


_conn = None


def init(conn):
    global _conn
    _conn = conn
    import_key_files()
    with conn() as c:
        c.execute(
            "CREATE TABLE IF NOT EXISTS ai_usage(ts INTEGER, model TEXT, prompt INTEGER, cached INTEGER, completion INTEGER, cost REAL)"
        )
        c.execute(
            "CREATE TABLE IF NOT EXISTS sources(id TEXT PRIMARY KEY, title TEXT, kind TEXT, url TEXT, chars INTEGER, n INTEGER, at INTEGER)"
        )
        c.execute(
            "CREATE VIRTUAL TABLE IF NOT EXISTS chunks USING fts5(src UNINDEXED, i UNINDEXED, text, tokenize='porter unicode61')"
        )


# ---------- spend ----------
def _month_start():
    t = time.gmtime(time.time() + 8 * 3600)  # Manila month
    return int(time.mktime((t.tm_year, t.tm_mon, 1, 0, 0, 0, 0, 0, 0)) - time.timezone - 8 * 3600)


def _day_start():
    return int((time.time() + 8 * 3600) // 86400 * 86400 - 8 * 3600)  # Manila midnight


def day_calls(model):
    with _conn() as c:
        return c.execute("SELECT COUNT(*) FROM ai_usage WHERE ts>=? AND model=?", (_day_start(), model)).fetchone()[0]


def _month_by_model():
    with _conn() as c:
        return c.execute(
            "SELECT model,COUNT(*),COALESCE(SUM(cost),0) FROM ai_usage WHERE ts>=? GROUP BY model", (_month_start(),)
        ).fetchall()


def spend(provider):
    """Estimated USD this Manila month on one provider."""
    return sum(cost for m, _, cost in _month_by_model() if split(m)[0] == provider)


backend_spend = spend


def catalog():
    """Everything the app's model picker needs, with live state: what can run now and why not."""
    c0 = cfg()
    with _conn() as c:
        day = dict(
            c.execute("SELECT model,COUNT(*) FROM ai_usage WHERE ts>=? GROUP BY model", (_day_start(),)).fetchall()
        )
    month = {}
    for m, _, cost in _month_by_model():
        month[split(m)[0]] = month.get(split(m)[0], 0) + cost
    out = []
    for p, pc in backends().items():
        if pc.get("off"):
            continue
        rows = []
        for mid, mc in (pc.get("models") or {}).items():
            if (mc or {}).get("hidden"):
                continue
            mc = mc or {}
            fid = full_id(p, mid)
            rows.append(
                {
                    "id": fid,
                    "label": mc.get("label") or mid,
                    "price": mc.get("price"),
                    "context": mc.get("context"),
                    "free_day": mc.get("free_day"),
                    "used": day.get(fid, 0),
                    "vision": bool(mc.get("vision")),
                    "why": why_not(fid),
                }
            )
        if not rows:
            continue
        out.append(
            {
                "id": p,
                "label": pc.get("label") or p,
                "free": bool(pc.get("free")),
                "ready": bool(key(p)),
                "spent": round(month.get(p, 0), 5),
                "cap": pc.get("cap_usd"),
                "signup": pc.get("signup"),
                "models": rows,
            }
        )
    return {"default": c0.get("default"), "utility": c0.get("utility"), "providers": out}


def usage():
    """Catalogue + month totals. Older app builds read the flat keys (models, model, free_day, context, paid, cap, active)."""
    c0 = cfg()
    cat = catalog()
    flat = [m for p in cat["providers"] for m in p["models"]]
    rows = _month_by_model()
    total = sum(r[2] for r in rows)
    orp = next((p for p in cat["providers"] if p["id"] == "openrouter"), {})
    return {
        **cat,
        "calls": sum(r[1] for r in rows),
        "cost": round(total, 5),
        "model": c0.get("default"),
        "models": [m["id"] for m in flat],
        "ready": any(p["ready"] for p in cat["providers"]),
        "day": {m["id"]: m["used"] for m in flat if m["used"]},
        "free_day": {m["id"]: m["free_day"] for m in flat if m["free_day"]},
        "context": {m["id"]: m["context"] for m in flat if m["context"]},
        "paid": {
            p["id"]: {"spent": p["spent"], "cap": p["cap"]}
            for p in cat["providers"]
            if p["cap"] is not None and p["id"] != "openrouter"
        },
        "cap": orp.get("cap"),
        "active": next((m for m in [c0.get("default")] + list(c0.get("chain") or []) if m and usable(m)), None),
    }


def _log(model, u):
    if not isinstance(u, dict):
        return
    det = u.get("prompt_tokens_details") or {}
    p, ca, o = (
        int(u.get("prompt_tokens") or 0),
        int(det.get("cached_tokens") or 0),
        int(u.get("completion_tokens") or 0),
    )
    cost = float(u.get("cost") or 0)
    price = (model_cfg(model) or {}).get("price")
    if price and not cost:  # no cost from the provider: estimate from the token counts
        # Anthropic input excludes cache reads/writes; Messages normalizes their sum into p.
        created = int(det.get("cache_creation_tokens") or 0)
        one_hour = int(det.get("cache_creation_1h_tokens") or 0)
        cost = (
            max(p - ca - created, 0) * price[0]
            + max(created - one_hour, 0) * price[0] * 1.25
            + one_hour * price[0] * 2
            + ca * (price[2] if len(price) > 2 else price[0])
            + o * price[1]
        ) / 1e6
    with _conn() as c:
        c.execute("INSERT INTO ai_usage VALUES(?,?,?,?,?,?)", (int(time.time()), model, p, ca, o, cost))


# ---------- chat ----------
def _cache_hints(msgs):
    """Anthropic models only cache where told to: mark the end of the system prompt and the newest message.
    (DeepSeek caches every prefix by itself.)"""
    out = [dict(m) for m in msgs]

    def mark(m):
        ct = m.get("content")
        if isinstance(ct, str) and ct:
            m["content"] = [{"type": "text", "text": ct, "cache_control": {"type": "ephemeral"}}]
        elif isinstance(ct, list) and ct:
            ct = [dict(p) for p in ct]
            ct[-1]["cache_control"] = {"type": "ephemeral"}
            m["content"] = ct

    for m in out:
        if m.get("role") == "system":
            mark(m)
            break
    for m in reversed(out):
        if m.get("role") in ("user", "tool"):
            mark(m)
            break
    return out


class Upstream(Exception):
    """No model could take the request: HTTP status + the JSON body the app shows."""

    def __init__(self, code, payload):
        super().__init__(payload.get("msg") or payload.get("error"))
        self.code = code
        self.payload = payload


def chat(h, body):
    """Stream one completion back to the app as server-sent events."""
    cors = {"Access-Control-Allow-Origin": "*"}
    try:
        resp, model, mid = connect(body)
    except Upstream as e:
        return h._send(e.code, e.payload, extra=cors)
    h.send_response(200)
    for a, b in (
        ("Content-Type", "text/event-stream"),
        ("Cache-Control", "no-cache"),
        ("X-Accel-Buffering", "no"),
        ("Access-Control-Allow-Origin", "*"),
    ):
        h.send_header(a, b)
    h.end_headers()
    out = lines(resp, model, mid)
    try:
        for line in out:
            h.wfile.write(line)
            h.wfile.flush()
    except (ConnectionError, OSError):
        pass  # Stop in the app closes the stream
    finally:
        out.close()


def connect(body):
    """Open a streaming completion: (response, model, model id) or Upstream. Shared by /api/ai and background runs (agent.py)."""
    c0 = cfg()
    msgs = body.get("messages")
    if not isinstance(msgs, list) or not msgs:
        raise Upstream(400, {"error": "messages required"})
    # the asked-for model if it can run, else the next in the chain; a free model that is busy or used up hands over to the next
    todo = candidates(body.get("model"))
    if not todo:
        if any(key(split(m)[0]) for m in models()):
            raise Upstream(402, {"error": "cap", "msg": "Every model you have a key for is at its limit for now."})
        raise Upstream(503, {"error": "no_key", "msg": "No AI key on the server yet."})
    resp = None
    err = None
    for model in todo:
        rt = info(model)
        be, mid, name = rt["be"], rt["mid"], rt["name"]
        prov = backends().get(be) or {}
        tools = list(body.get("tools") or [])
        if prov.get("openrouter") and body.get("web") and c0.get("web_tool"):
            tools.append(c0["web_tool"])  # OpenRouter's own search tool
        up = {
            "model": mid,
            "messages": msgs,
            "stream": True,
            "max_tokens": int(body.get("max_tokens") or c0.get("max_tokens") or 4000),
        }
        if tools:
            up["tools"] = tools
        try:
            req = request(rt, prepare(rt, up))
        except ValueError as e:
            raise Upstream(400, {"error": "messages", "msg": str(e)}) from None
        for wait in (4, 0):
            try:
                resp = urllib.request.urlopen(req, timeout=40)
                break  # a stalled free model must not hold the chat on "Thinking" for minutes: give up and try the next one
            except urllib.error.HTTPError as e:
                try:
                    msg = json.loads(e.read() or b"{}").get("error", {}).get("message", "")
                except (ValueError, AttributeError):
                    msg = ""
                if e.code == 429 and prov.get("free") and wait:
                    time.sleep(wait)
                    continue  # free tiers limit per minute
                err = (e.code, msg or ("%s answered %d" % (name, e.code)))
                break
            except (urllib.error.URLError, TimeoutError):
                err = (0, "Couldn't reach %s." % name)
                break
        if resp:
            break
        if err[0] not in (0, 429, 500, 502, 503):
            break  # a real error (bad request, bad key) is shown, not hidden behind another model
    if not resp:
        if err[0] == 429:
            raise Upstream(
                502,
                {
                    "error": "upstream",
                    "msg": "The models are busy or used up for now. Try again in a minute, or pick another model in ⋯.",
                },
            )
        raise Upstream(502, {"error": "upstream", "msg": err[1]})
    return resp, model, mid


def lines(resp, model, mid):
    """The upstream SSE lines, with inline thinking stripped, token use logged and a {"sos": usage} line before [DONE]."""
    strip = _NoThought() if _thinks_inline(model) else None
    got = None
    try:
        protocol = (backends().get(split(model)[0]) or {}).get("protocol")
        upstream = ai_messages.stream(resp) if protocol == "anthropic" else resp
        for line in upstream:
            if line.startswith(b"data: ") and line.strip() != b"data: [DONE]":
                try:
                    o = json.loads(line[6:])
                    if o.get("usage"):
                        got = o["usage"]
                    if strip:
                        for ch in o.get("choices") or []:
                            d = ch.get("delta") or {}
                            if d.get("content"):
                                d["content"] = strip.feed(d["content"])
                        line = b"data: " + json.dumps(o).encode() + b"\n"
                except ValueError:
                    pass
            if line.strip() == b"data: [DONE]" and got is not None:
                ctx = int(got.get("prompt_tokens") or 0)  # what this request sent = how full the chat's context is
                _log(model, got)
                got = None
                be = split(model)[0]
                prov = backends().get(be) or {}
                yield (
                    b"data: "
                    + json.dumps(
                        {
                            "sos": {
                                "model": model,
                                "month": round(spend(be), 5),
                                "cap": prov.get("cap_usd"),
                                "day": day_calls(model),
                                "ctx": ctx,
                                "cmax": (model_cfg(model) or {}).get("context") or 0,
                            }
                        }
                    ).encode()
                    + b"\n\n"
                )
            yield line
    finally:
        if got is not None:
            _log(model, got)
        resp.close()


# ---------- sources ----------
class _Text(HTMLParser):
    SKIP = {"script", "style", "noscript", "svg", "nav", "footer", "header", "aside", "form", "iframe", "button"}
    BLOCK = {
        "p",
        "div",
        "br",
        "li",
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
        "tr",
        "section",
        "article",
        "pre",
        "blockquote",
        "table",
    }

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.out = []
        self.skip = 0
        self.title = ""
        self._t = False

    def handle_starttag(self, tag, a):
        if tag in self.SKIP:
            self.skip += 1
        if tag == "title":
            self._t = True
        if tag in self.BLOCK:
            self.out.append("\n")
        if tag in ("h1", "h2", "h3") and not self.skip:
            self.out.append("## ")

    def handle_endtag(self, tag):
        if tag in self.SKIP and self.skip:
            self.skip -= 1
        if tag == "title":
            self._t = False
        if tag in self.BLOCK:
            self.out.append("\n")

    def handle_data(self, d):
        if self._t:
            self.title += d
        elif not self.skip:
            self.out.append(d)


def _clean(t):
    t = t.replace("\r", "")
    t = re.sub(r"[ \t ]+", " ", t)
    t = re.sub(r" *\n *", "\n", t)
    return re.sub(r"\n{3,}", "\n\n", t).strip()


# Links the assistant follows (read_url, sources) come from web pages and chats, so they may only reach the public internet:
# no loopback, private, link-local, Tailscale (100.64/10) or metadata addresses, checked on the address actually connected to
# (so a DNS name that points inward is refused too) and again on every redirect. No proxies, http(s) only.
class Blocked(ValueError):
    pass


def _public(ip):
    a = ipaddress.ip_address(ip.split("%")[0])
    if a.version == 6 and a.ipv4_mapped:
        a = a.ipv4_mapped
    return a.is_global and not a.is_multicast


def _connect(addr, timeout=socket._GLOBAL_DEFAULT_TIMEOUT, source_address=None):
    host, port = addr
    infos = socket.getaddrinfo(host, port, 0, socket.SOCK_STREAM)
    if not infos or any(not _public(sa[0]) for *_, sa in infos):
        raise Blocked("That address is on a private network.")
    err = None
    for fam, typ, proto, _, sa in infos:
        s = socket.socket(fam, typ, proto)
        try:
            if timeout is not socket._GLOBAL_DEFAULT_TIMEOUT:
                s.settimeout(timeout)
            s.connect(sa)
            return s
        except OSError as e:
            err = e
            s.close()
    raise err


class _Http(http.client.HTTPConnection):
    def __init__(self, *a, **k):
        super().__init__(*a, **k)
        self._create_connection = _connect


class _Https(http.client.HTTPSConnection):
    def __init__(self, *a, **k):
        super().__init__(*a, **k)
        self._create_connection = _connect


class _HttpH(urllib.request.HTTPHandler):
    def http_open(self, req):
        return self.do_open(_Http, req)


class _HttpsH(urllib.request.HTTPSHandler):
    def https_open(self, req):
        return self.do_open(_Https, req, context=self._context)


class _Redir(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if urllib.parse.urlparse(newurl).scheme not in ("http", "https"):
            raise Blocked("Redirected somewhere that isn't a web page.")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


_PUBLIC = urllib.request.build_opener(urllib.request.ProxyHandler({}), _HttpH, _HttpsH, _Redir)


def _get(url, limit=20 * 1024 * 1024, local=False):
    """local=True only for addresses from the server's own config (SearXNG)."""
    if not local and urllib.parse.urlparse(url).scheme not in ("http", "https"):
        raise Blocked("Only http and https links can be read.")
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "en"})
    with urllib.request.urlopen(req, timeout=40) if local else _PUBLIC.open(req, timeout=40) as r:
        return r.read(limit), (r.headers.get("Content-Type") or "").lower(), r.geturl()


def _pdf_text(data):
    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as f:
        f.write(data)
        p = f.name
    try:
        out = subprocess.run(["pdftotext", "-enc", "UTF-8", p, "-"], capture_output=True, timeout=120)
        if out.returncode != 0:
            raise ValueError("Couldn't read that PDF.")
        pages = out.stdout.decode("utf-8", "replace").split("\f")
        return "\n".join("[p.%d]\n%s" % (i + 1, pg) for i, pg in enumerate(pages) if pg.strip())
    except FileNotFoundError:
        raise ValueError("pdftotext isn't installed on the server (sudo apt install poppler-utils).")
    finally:
        os.unlink(p)


def _youtube(url):
    m = re.search(r"(?:v=|youtu\.be/|shorts/|embed/)([A-Za-z0-9_-]{11})", url)
    if not m:
        raise ValueError("That doesn't look like a YouTube video link.")
    page, _, _ = _get("https://www.youtube.com/watch?v=" + m.group(1) + "&hl=en")
    page = page.decode("utf-8", "replace")
    title = (
        htmllib.unescape((re.search(r"<title>(.*?)</title>", page, re.S) or [None, "YouTube video"])[1])
        .replace(" - YouTube", "")
        .strip()
    )
    tm = re.search(r'"captionTracks":(\[.*?\])', page)
    if not tm:
        raise ValueError("That video has no captions to read.")
    tracks = json.loads(tm.group(1))
    tr = (
        next((t for t in tracks if t.get("languageCode", "").startswith("en") and t.get("kind") != "asr"), None)
        or next((t for t in tracks if t.get("languageCode", "").startswith("en")), None)
        or tracks[0]
    )
    xml, _, _ = _get(tr["baseUrl"])
    out, last = [], -60
    for st, txt in re.findall(r'<text start="([\d.]+)"[^>]*>(.*?)</text>', xml.decode("utf-8", "replace"), re.S):
        s = float(st)
        if s - last >= 60:
            out.append("\n[%d:%02d] " % (s // 60, s % 60))
            last = s
        out.append(htmllib.unescape(htmllib.unescape(txt)).replace("\n", " ") + " ")
    if not out:
        raise ValueError("Couldn't read that video's captions.")
    return title, "".join(out)


def _chunks(text):
    """~CHUNK-char pieces cut on paragraph/sentence breaks; each remembers the last page marker it passed."""
    out, buf, page = [], "", ""
    for para in re.split(r"\n\s*\n|\n(?=\[p\.\d+\])", text):
        pm = re.match(r"\[p\.(\d+)\]", para.strip())
        if pm:
            page = "[p.%s] " % pm.group(1)
        while len(para) > CHUNK * 1.5:
            cut = para.rfind(". ", 0, CHUNK) + 1 or CHUNK
            if buf:
                out.append(buf)
                buf = ""
            out.append((page if not para.startswith("[p.") else "") + para[:cut].strip())
            para = para[cut:]
        if len(buf) + len(para) > CHUNK and buf:
            out.append(buf)
            buf = ""
        buf = (
            (buf + "\n\n" + para).strip()
            if buf
            else ((page if page and not para.strip().startswith("[p.") else "") + para.strip())
        )
    if buf.strip():
        out.append(buf)
    return [c for c in out if c.strip()]


def add_source(body, files_dir, file_re):
    sid = str(body.get("id") or "")[:40]
    if not re.match(r"^[A-Za-z0-9_-]{6,40}$", sid):
        raise ValueError("bad id")
    kind = body.get("kind")
    title = str(body.get("title") or "").strip()[:200]
    url = ""
    if kind == "text":
        text = str(body.get("text") or "")
    elif kind == "url":
        url = str(body.get("url") or "").strip()
        if not re.match(r"^https?://", url):
            url = "https://" + url
        if re.search(r"(youtube\.com|youtu\.be)/", url):
            t, text = _youtube(url)
            kind = "video"
            title = title or t
        else:
            data, ctype, final = _get(url)
            if "pdf" in ctype or data[:5] == b"%PDF-":
                text = _pdf_text(data)
                kind = "pdf"
                title = title or os.path.basename(urllib.parse.urlparse(final).path) or "PDF"
            else:
                p = _Text()
                p.feed(data.decode("utf-8", "replace"))
                text = "".join(p.out)
                title = title or _clean(htmllib.unescape(p.title))[:200] or url
    elif kind == "file":
        fid = str(body.get("file") or "")
        f = os.path.join(files_dir, fid)
        if not file_re.match(fid) or not os.path.isfile(f):
            raise ValueError("Upload the file first.")
        with open(f, "rb") as fh:
            data = fh.read()
        if data[:5] != b"%PDF-":
            raise ValueError("Only PDFs can be sources (attach images to a chat instead).")
        text = _pdf_text(data)
        kind = "pdf"
        title = title or "PDF"
    else:
        raise ValueError("kind must be text, url or file")
    text = _clean(text)[:MAXTEXT]
    if len(text) < 40:
        raise ValueError("Found almost no text there.")
    parts = _chunks(text)
    with _conn() as c:
        c.execute("DELETE FROM chunks WHERE src=?", (sid,))
        c.executemany("INSERT INTO chunks(src,i,text) VALUES(?,?,?)", [(sid, i, t) for i, t in enumerate(parts)])
        c.execute(
            "INSERT OR REPLACE INTO sources VALUES(?,?,?,?,?,?,?)",
            (sid, title or "Untitled", kind, url, len(text), len(parts), int(time.time())),
        )
    return {"id": sid, "title": title or "Untitled", "kind": kind, "url": url, "chars": len(text), "n": len(parts)}


_WORD = re.compile(r"[\wÀ-￿]{2,}", re.U)


def search(body):
    q = str(body.get("q") or "")
    words = list(dict.fromkeys(w.lower() for w in _WORD.findall(q)))[:12]
    if not words:
        return {"hits": []}
    k = max(1, min(12, int(body.get("k") or 6)))
    srcs = [str(s) for s in (body.get("src") or [])][:50]
    fq = " OR ".join('"%s"' % w.replace('"', "") for w in words)
    sql = "SELECT src,i,text,bm25(chunks) r FROM chunks WHERE chunks MATCH ?"
    args = [fq]
    if srcs:
        sql += " AND src IN (%s)" % ",".join("?" * len(srcs))
        args += srcs
    with _conn() as c:
        rows = c.execute(sql + " ORDER BY r LIMIT ?", args + [k]).fetchall()
        titles = dict(c.execute("SELECT id,title FROM sources").fetchall())
    return {"hits": [{"src": s, "title": titles.get(s, ""), "i": int(i), "text": t[:1600]} for s, i, t, _ in rows]}


def read(body):
    sid = str(body.get("src") or "")
    i = max(0, int(body.get("i") or 0))
    n = max(1, min(6, int(body.get("n") or 3)))
    with _conn() as c:
        row = c.execute("SELECT title,n FROM sources WHERE id=?", (sid,)).fetchone()
        if not row:
            raise ValueError("No such source.")
        rows = c.execute(
            "SELECT i,text FROM chunks WHERE src=? AND CAST(i AS INTEGER) BETWEEN ? AND ? ORDER BY CAST(i AS INTEGER)",
            (sid, i, i + n - 1),
        ).fetchall()
    return {"title": row[0], "total": row[1], "from": i, "parts": [t for _, t in rows]}


def web_read(body):
    """The assistant's read_url tool: one page as plain text (free, unlike a search)."""
    url = str(body.get("url") or "").strip()
    if not re.match(r"^https?://", url):
        url = "https://" + url
    if re.search(r"(youtube\.com|youtu\.be)/", url):
        t, text = _youtube(url)
    else:
        data, ctype, _ = _get(url, 8 * 1024 * 1024)
        if "pdf" in ctype or data[:5] == b"%PDF-":
            t, text = "PDF", _pdf_text(data)
        else:
            p = _Text()
            p.feed(data.decode("utf-8", "replace"))
            t, text = _clean(htmllib.unescape(p.title)), "".join(p.out)
    text = _clean(text)
    start = max(0, int(body.get("from") or 0))
    n = 9000
    return {
        "title": t[:200],
        "text": text[start : start + n],
        "from": start,
        "total": len(text),
        "more": start + n < len(text),
    }


def _tidy(h):
    return _clean(htmllib.unescape(re.sub(r"<[^>]+>", " ", h or "")))


def _search_braveapi(q):
    """Brave's official Search API (free plan: api-dashboard.search.brave.com). Skipped until brave_key.txt or BRAVE_API_KEY exists."""
    k = secret("brave", "BRAVE_API_KEY")
    if not k:
        return []
    req = urllib.request.Request(
        "https://api.search.brave.com/res/v1/web/search?" + urllib.parse.urlencode({"q": q, "count": 6}),
        headers={"X-Subscription-Token": k, "Accept": "application/json", "User-Agent": UA},
    )
    with urllib.request.urlopen(req, timeout=20) as r:
        d = json.load(r)
    return [
        {"title": _tidy(x.get("title")), "url": x.get("url"), "snippet": _tidy(x.get("description"))[:240]}
        for x in (d.get("web") or {}).get("results", [])
        if x.get("url")
    ]


def _search_searxng(q):
    """The SearXNG next to the server (ai.json "searxng" overrides the address). Its engines get suspended now and then, then it returns nothing."""
    base = str(cfg().get("searxng") or "http://127.0.0.1:8080").rstrip("/")
    data, _, _ = _get(base + "/search?" + urllib.parse.urlencode({"q": q, "format": "json"}), 1024 * 1024, local=True)
    return [
        {"title": _tidy(r.get("title")), "url": r.get("url"), "snippet": _tidy(r.get("content"))[:240]}
        for r in json.loads(data).get("results", [])
        if r.get("url")
    ]


def _search_brave(q):
    data, _, _ = _get(
        "https://search.brave.com/search?" + urllib.parse.urlencode({"q": q, "source": "web"}), 2 * 1024 * 1024
    )
    out = []
    for blk in re.findall(
        r'<div class="snippet[^"]*"[^>]*data-type="web".*?(?=<div class="snippet|\Z)',
        data.decode("utf-8", "replace"),
        re.S,
    ):
        a = re.search(r'<a[^>]+href="(https?://[^"]+)"', blk)
        t = re.search(r'class="[^"]*search-snippet-title[^"]*"[^>]*>(.*?)</div>', blk, re.S)
        d = re.search(r'class="content [^"]*"[^>]*>(.*?)</div>', blk, re.S)
        if a and t:
            out.append(
                {
                    "title": _tidy(t.group(1)),
                    "url": htmllib.unescape(a.group(1)),
                    "snippet": _tidy(d.group(1) if d else "")[:240],
                }
            )
    return out


def _search_wikipedia(q):
    data, _, _ = _get(
        "https://en.wikipedia.org/w/api.php?"
        + urllib.parse.urlencode({"action": "query", "list": "search", "srsearch": q, "srlimit": 5, "format": "json"}),
        512 * 1024,
    )
    return [
        {
            "title": r["title"],
            "url": "https://en.wikipedia.org/wiki/" + urllib.parse.quote(r["title"].replace(" ", "_")),
            "snippet": _tidy(r.get("snippet"))[:240],
        }
        for r in json.loads(data)["query"]["search"]
    ]


def web_search(body):
    """The assistant's web_search tool for models that have no search of their own (local ones): title, link and snippet per result."""
    q = str(body.get("q") or "").strip()[:200]
    if not q:
        raise ValueError("Say what to search for.")
    for fn in (_search_braveapi, _search_searxng, _search_brave, _search_wikipedia):
        try:
            res = fn(q)
        except Exception:
            res = []
        if res:
            return {"results": res[:6], "via": fn.__name__.replace("_search_", "")}
    raise ValueError("Web search isn't answering right now. Try again in a bit.")


def delete(body):
    sid = str(body.get("id") or "")
    with _conn() as c:
        c.execute("DELETE FROM chunks WHERE src=?", (sid,))
        c.execute("DELETE FROM sources WHERE id=?", (sid,))
    return {"ok": True}
