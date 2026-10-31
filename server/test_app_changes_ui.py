"""Optional headless UI checks, using fake Sync credentials and stubbed APIs only."""

import json
import unittest
from pathlib import Path

try:
    from playwright.sync_api import sync_playwright
except ImportError:
    # a script (python server/test_app_changes_ui.py), not a unit test: skip it in discovery when Playwright is missing
    raise unittest.SkipTest("playwright is not installed")


def main():
    root = Path(__file__).resolve().parent.parent
    output = root / ".osage-stage/ui"
    output.mkdir(parents=True, exist_ok=True)
    job = {
        "id": "a" * 32,
        "status": "ready",
        "request": "Add a reading tracker",
        "at": "2026-10-27T00:00:00Z",
        "base": "test-base",
        "files": ["src/modules/reading.js"],
        "summary": "a reading list under Notes, using the existing app styling.",
        "calls": 3,
        "prompt": 10000,
        "cached": 8000,
        "completion": 600,
        "cost": 0.001,
        "preview": "/preview/" + "a" * 32 + "/",
    }
    calls = []
    created = []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        for name, viewport, skin, touch in [
            ("desktop", {"width": 1280, "height": 900}, "gray", False),
            ("mobile", {"width": 393, "height": 851}, "night", True),
        ]:
            context = browser.new_context(viewport=viewport, has_touch=touch, is_mobile=touch)
            active_job = dict(job)
            seed = {
                "os-open": ["buddy"],
                "os-view": "buddy",
                "os-skin": skin,
                "os-pos": {"buddy": {"x": 50, "y": 120, "w": 850, "h": 650}},
                "os-sync": {"url": "https://test.invalid", "token": "test-token", "on": True},
                # the assistant and app editing are optional modules: on, with a server that has them
                "os-caps": {"url": "https://test.invalid", "caps": ["changes"]},
                "sos-db": {"config": {"modules": {"ai": True, "changes": True, "_u": 1}}},
            }
            context.add_init_script(
                "try { const values="
                + json.dumps(seed)
                + "; for(const [k,v] of Object.entries(values))localStorage.setItem(k,JSON.stringify(v));}catch(e){}"
            )

            def route(request):
                path = request.request.url.split("test.invalid", 1)[1]
                if path.startswith("/preview/"):
                    return request.fulfill(
                        status=200,
                        body="<html><body>isolated preview</body></html>",
                        content_type="text/html",
                        headers={"Content-Security-Policy": "sandbox allow-scripts; default-src 'none'"},
                    )
                calls.append(path)
                if path == "/api/change/list":
                    result = {"ready": True, "drafts": [active_job]}
                elif path == "/api/change/detail":
                    result = {**active_job, "diff": "--- old\n+++ new\n+reading tracker"}
                elif path == "/api/ai/usage":
                    result = {
                        "ready": True,
                        "cost": 0,
                        "cap": 5,
                        "default": "g:lite",
                        "providers": [
                            {
                                "id": "g",
                                "label": "Gemini",
                                "ready": True,
                                "models": [
                                    {"id": "g:lite", "label": "Flash Lite", "why": None},
                                    {"id": "g:pro", "label": "Pro", "why": None},
                                    {"id": "g:max", "label": "Max", "why": "monthly cap reached"},
                                ],
                            },
                            {
                                "id": "x",
                                "label": "NoKey",
                                "ready": False,
                                "models": [{"id": "x:m", "label": "Hidden", "why": "no key"}],
                            },
                        ],
                    }
                elif path == "/api/change/create":
                    created.append(json.loads(request.request.post_data or "{}"))
                    result = active_job
                elif path == "/api/change/apply":
                    active_job.update(status="applied", commit="test-commit")
                    result = active_job
                else:
                    result = {}
                request.fulfill(
                    json=result,
                    headers={
                        "Access-Control-Allow-Origin": "*",
                        "Access-Control-Allow-Headers": "Authorization,Content-Type",
                        "Access-Control-Allow-Methods": "POST,GET,OPTIONS",
                    },
                )

            context.route("https://test.invalid/**", route)
            context.route("https://fonts.googleapis.com/**", lambda r: r.abort())
            context.route("https://fonts.gstatic.com/**", lambda r: r.abort())
            page = context.new_page()
            errors = []
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.goto((root / "dist/index.html").as_uri())
            page.get_by_role("button", name="Buddy settings").first.click()
            page.get_by_text("Change the app…", exact=True).click()
            # A draft waiting on the user opens straight to its next step.
            page.get_by_text("Ready to try", exact=True).wait_for()
            assert page.get_by_role("button", name="Discard").count() == 1, "a ready draft can be discarded"
            page.locator(".acsteps li.on", has_text="Try it").wait_for()
            page.get_by_text("Details", exact=True).click()
            assert "reading tracker" in page.locator(".acdiff pre").inner_text()
            assert not any(path == "/api/change/apply" for path in calls)
            page.get_by_role("button", name="Try it", exact=True).click()
            frame = page.locator("iframe[title='App change preview']")
            assert frame.get_attribute("sandbox") == "allow-scripts"
            assert page.locator(".achange").evaluate("el=>el.scrollWidth<=el.clientWidth+1")
            page.screenshot(path=str(output / (name + "-preview.png")))
            page.get_by_role("button", name="‹ Back", exact=True).click()
            page.get_by_text("Happy with it?", exact=True).wait_for()
            page.screenshot(path=str(output / (name + ".png")))
            # Explicit user action is the only path that calls publish.
            page.get_by_role("button", name="Apply to my app", exact=True).click()
            page.get_by_text("Live in your app", exact=True).wait_for()
            page.get_by_role("button", name="Undo this change", exact=True).wait_for()
            page.screenshot(path=str(output / (name + "-live.png")))
            page.get_by_role("button", name="‹ All changes", exact=True).click()
            assert page.get_by_role("button", name="Make draft", exact=True).is_disabled()
            page.get_by_label("What should change?").fill("Make the tracker compact")
            assert page.get_by_role("button", name="Make draft", exact=True).is_enabled()
            box = page.locator(".acmodel select")
            assert "Default (Flash Lite)" in box.inner_text() and "Hidden" not in box.inner_text()
            assert page.locator(".acmodel option[value='g:max']").evaluate("o=>o.disabled")
            box.select_option("g:pro")
            page.screenshot(path=str(output / (name + "-home.png")))
            page.get_by_role("button", name="Make draft", exact=True).click()
            page.wait_for_function("1")
            page.get_by_text("‹ All changes", exact=True).wait_for()
            assert created[-1] == {"request": "Make the tracker compact", "model": "g:pro"}, created
            assert calls.count("/api/change/apply") == 1
            calls.clear()
            assert not errors, errors
            context.close()
        browser.close()
    print("Phone/night and desktop/light checks passed; preview cannot publish; Apply requires a click.")


if __name__ == "__main__":
    main()
