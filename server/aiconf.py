"""AI settings from the app (Models window): add providers, store keys, pick models from the provider's live list,
choose the default and utility model. Everything needs the sync token. Keys go into secrets.json (0600) and are never
sent back: the app only learns whether a provider has one. Providers and models are written to ai.json."""

import json
import os
import re
import time
import threading
import urllib.request
import urllib.error
import ai

_lock = threading.Lock()
_lists = {}  # provider -> (time, models) so reopening the picker doesn't refetch


def _raw():
    o = ai._load(ai.CFG_FILE)
    return o if isinstance(o, dict) else {}


def _save(o):
    tmp = ai.CFG_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(o, f, indent=1)
    os.replace(tmp, ai.CFG_FILE)


def _pid(b):
    p = str(b.get("provider") or b.get("id") or "")
    if p not in ai.backends():
        raise ValueError("No such provider.")
    return p


def setup(_b=None):
    c0 = ai.cfg()
    ks = ai.kinds()
    provs = []
    for p, pc in ai.backends().items():
        provs.append(
            {
                "id": p,
                "kind": pc.get("kind") or (p if p in ks else "custom"),
                "label": pc.get("label") or p,
                "url": pc.get("url") or "",
                "protocol": pc.get("protocol", "openai"),
                "nokey": bool(pc.get("nokey")),
                "ready": bool(pc.get("nokey")) or bool(ai.key(p)),
                "cap": pc.get("cap_usd"),
                "spent": round(ai.spend(p), 4),
                "signup": pc.get("signup"),
                "off": bool(pc.get("off")),
                "models": [
                    {"id": ai.full_id(p, m), "mid": m, "label": (mc or {}).get("label") or m}
                    for m, mc in (pc.get("models") or {}).items()
                    if not (mc or {}).get("hidden")
                ],
            }
        )
    return {
        "kinds": [
            {
                "id": k,
                "label": v.get("label") or k,
                "signup": v.get("signup"),
                "url": v.get("url") or "",
                "needs_url": bool(v.get("needs_url")),
                "nokey": bool(v.get("nokey")),
                "free": bool(v.get("free")),
            }
            for k, v in ks.items()
        ],
        "providers": provs,
        "default": c0.get("default") or "",
        "utility": c0.get("utility") or "",
        "brave": bool(ai.secret("brave", "BRAVE_API_KEY")),
    }


def provider(b):
    """Add {kind, label?, url?, protocol?}, edit {id, label?, url?, cap?, off?} or remove {id, remove: true}."""
    with _lock:
        o = _raw()
        provs = o.setdefault("providers", {})
        if b.get("remove"):
            p = _pid(b)
            if p in (ai._load(ai.CATALOG_FILE).get("providers") or {}):
                provs[p] = None  # a shipped one is switched off with null
            else:
                provs.pop(p, None)
            for k in ("default", "utility"):
                if ai.split(o.get(k) or "")[0] == p:
                    o.pop(k, None)
            if o.get("chain"):
                o["chain"] = [m for m in o["chain"] if ai.split(m)[0] != p]
            _save(o)
            ai.set_secret(p, "")
            _lists.pop(p, None)
            return setup()
        if b.get("id"):
            p = _pid(b)
            e = provs.setdefault(p, {})
        else:
            kind = str(b.get("kind") or "")
            if kind not in ai.kinds():
                raise ValueError("Unknown provider type.")
            base = (
                kind
                if kind != "custom"
                else re.sub(r"[^a-z0-9]+", "-", str(b.get("label") or "custom").lower()).strip("-")[:20] or "custom"
            )
            p, n = base, 2
            while p in ai.backends():
                p = "%s-%d" % (base, n)
                n += 1
            e = provs[p] = {"kind": kind, "models": {}}
        if "label" in b and str(b["label"]).strip():
            e["label"] = str(b["label"]).strip()[:60]
        if "url" in b:
            u = str(b["url"]).strip()
            if u:
                if not re.match(r"^https?://[^\s/]+", u):
                    raise ValueError("The address should start with http:// or https://.")
                if not re.search(r"/(chat/completions|messages)$", u):
                    u = u.rstrip("/") + ("/messages" if b.get("protocol") == "anthropic" else "/chat/completions")
                e["url"] = u[:300]
        if b.get("protocol") in ("openai", "anthropic"):
            e["protocol"] = b["protocol"]
        if "cap" in b:
            if b["cap"] in (None, ""):
                e.pop("cap_usd", None)
            else:
                e["cap_usd"] = max(0.0, float(b["cap"]))
        if "off" in b:
            e["off"] = bool(b["off"])
        if (ai.kinds().get(e.get("kind") or p) or {}).get("needs_url") and not (
            e.get("url") or (ai.kinds().get(e.get("kind")) or {}).get("url")
        ):
            raise ValueError("This provider needs an address.")
        _save(o)
    out = setup()
    out["id"] = p
    return out


def set_key(b):
    p = _pid(b)
    k = str(b.get("key") or "").strip()
    if len(k) > 500 or re.search(r"\s", k):
        raise ValueError("That doesn't look like an API key.")
    ai.set_secret(p, k)
    _lists.pop(p, None)
    return {"ok": True, "ready": bool(k)}


def set_search_key(b):
    k = str(b.get("key") or "").strip()
    if len(k) > 500 or re.search(r"\s", k):
        raise ValueError("That doesn't look like an API key.")
    ai.set_secret("brave", k)
    return {"ok": True}


def _models_url(pc):
    if pc.get("models_url"):
        return pc["models_url"]
    return re.sub(r"/(chat/completions|messages)$", "/models", pc.get("url") or "")


def _price(pr):
    try:
        out = [float(pr.get("prompt") or 0) * 1e6, float(pr.get("completion") or 0) * 1e6]
        if pr.get("input_cache_read"):
            out.append(float(pr["input_cache_read"]) * 1e6)
        return [round(x, 4) for x in out]
    except (TypeError, ValueError):
        return None


def live(b):
    """The provider's own model list, so nothing is hardcoded: id, label and whatever it tells us (context, price, images)."""
    p = _pid(b)
    pc = ai.backends()[p]
    k = ai.key(p)
    hit = _lists.get(p)
    if hit and time.time() - hit[0] < 600 and not b.get("fresh"):
        return {"models": hit[1]}
    if not k:
        raise ValueError("Add a key first.")
    url = _models_url(pc)
    if not url:
        raise ValueError("This provider has no address.")
    h = {"User-Agent": "toybox-os/1.0", "Accept": "application/json"}
    if pc.get("protocol") == "anthropic":
        h.update({"x-api-key": k, "anthropic-version": "2023-06-01"})
    if k != "none":
        h["Authorization"] = "Bearer " + k
    try:
        with urllib.request.urlopen(
            urllib.request.Request(url + ("?limit=1000" if pc.get("protocol") == "anthropic" else ""), headers=h),
            timeout=20,
        ) as r:
            d = json.load(r)
    except urllib.error.HTTPError as e:
        raise ValueError(
            {401: "The provider says the key is wrong.", 403: "The provider refused this key."}.get(
                e.code, "The provider answered %d." % e.code
            )
        ) from None
    except (urllib.error.URLError, TimeoutError, ValueError):
        raise ValueError("Couldn't reach the provider at " + url + ".") from None
    rows = d.get("data") if isinstance(d, dict) else d
    if isinstance(d, dict) and not rows:
        rows = d.get("models") or []
    out = []
    for r in rows or []:
        if not isinstance(r, dict):
            continue
        mid = str(r.get("id") or r.get("name") or "").removeprefix("models/")
        if not mid or re.search(
            r"(embed|tts|whisper|dall-e|image-gen|moderation|audio|transcribe|realtime)", mid, re.I
        ):
            continue
        m = {"id": mid, "label": str(r.get("name") or r.get("display_name") or mid)[:80]}
        ctx = r.get("context_length") or r.get("context_window") or (r.get("top_provider") or {}).get("context_length")
        if isinstance(ctx, int) and ctx > 0:
            m["context"] = ctx
        if isinstance(r.get("pricing"), dict):
            pr = _price(r["pricing"])
            if pr:
                m["price"] = pr
        mods = (r.get("architecture") or {}).get("input_modalities") or []
        if "image" in mods:
            m["vision"] = True
        out.append(m)
    out.sort(key=lambda m: m["label"].lower())
    _lists[p] = (time.time(), out)
    return {"models": out}


def enable(b):
    """Turn models on {provider, on: [{id, label, context, price, vision}]} or off {provider, off: [ids]}."""
    p = _pid(b)
    with _lock:
        o = _raw()
        e = o.setdefault("providers", {}).setdefault(p, {})
        ms = e.setdefault("models", {})
        known = {m["id"]: m for m in (_lists.get(p) or (0, []))[1]}
        for m in b.get("on") or []:
            mid = str((m or {}).get("id") if isinstance(m, dict) else m or "").strip()[:120]
            if not mid:
                continue
            src = known.get(mid) or (m if isinstance(m, dict) else {})
            ent = {k: src[k] for k in ("label", "context", "price", "vision") if src.get(k) not in (None, "", [])}
            ms[mid] = {**(ms.get(mid) or {}), **ent}
        for mid in b.get("off") or []:
            ms.pop(str(mid), None)
            fid = ai.full_id(p, str(mid))
            for k in ("default", "utility"):
                if o.get(k) == fid:
                    o.pop(k)
            if o.get("chain"):
                o["chain"] = [x for x in o["chain"] if x != fid]
        _save(o)
    return setup()


def defaults(b):
    with _lock:
        o = _raw()
        ms = ai.models()
        for k in ("default", "utility"):
            if k in b:
                v = str(b[k] or "")
                if v and v not in ms:
                    raise ValueError("That model isn't turned on.")
                if v:
                    o[k] = v
                else:
                    o.pop(k, None)
        _save(o)
    return setup()


ROUTES = {
    "/api/ai/setup": setup,
    "/api/ai/provider": provider,
    "/api/ai/key": set_key,
    "/api/ai/searchkey": set_search_key,
    "/api/ai/live": live,
    "/api/ai/enable": enable,
    "/api/ai/defaults": defaults,
}
