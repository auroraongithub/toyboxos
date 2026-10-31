"""Jobs as a tracker on a server without the job feed: add a job, move it through the stages, edit it, quick-add one,
and check the layout. Also checks that a server with the feed still shows the New tab. Desktop and phone."""

import unittest

from playwright.sync_api import sync_playwright

from harness import CHECKS, MODULES, SHOTS, new_context, open_window, server, shot

NO_FEED = {"caps": ["ai", "moodle", "admin", "changes"]}


def live_jobs(page):
    js = "() => Object.values(JSON.parse(localStorage.getItem('sos-db') || '{}').jobs || {}).filter(d => !d._d)"
    return page.evaluate(js)


def tab_names(page):
    return [t.strip() for t in page.locator(".win [role=tab]").all_inner_texts()]


class Jobs(unittest.TestCase):
    def tracker(self, phone):
        dev = "phone" if phone else "desk"
        with server() as url, sync_playwright() as pw:
            browser = pw.chromium.launch()
            data = {"config": {"modules": {**MODULES, "_u": 1}}}
            ctx = new_context(browser, pw, phone, url, caps=NO_FEED, data=data)
            page = ctx.new_page()
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.goto(url + "/")
            page.wait_for_timeout(1500)
            open_window(page, "jobs")

            # no feed: the tracker starts at Saved and there is no New tab
            self.assertFalse(any(t.startswith("New") for t in tab_names(page)), tab_names(page))
            self.assertIn("Add the jobs", page.locator(".nil").inner_text())

            # add one through the form (desktop: Add button; phone: the + opens quick add, so use the form via edit later)
            if phone:
                page.locator(".qfab").click()
                page.wait_for_timeout(400)
                page.keyboard.type("frontend dev at Acme")
                page.keyboard.press("Enter")
                page.wait_for_timeout(600)
                jobs = live_jobs(page)
                self.assertEqual(
                    [(j["title"], j["company"], j["status"]) for j in jobs], [("frontend dev", "Acme", "saved")]
                )
            else:
                page.locator(".jadd button").click()
                page.wait_for_timeout(400)
                page.fill("#job-title", "Frontend developer")
                page.fill("#job-company", "Acme")
                page.fill("#job-url", "example.com/jobs/1")
                page.fill("#job-pay", "$12/hr")
                page.fill("#job-notes", "Talked to Mia")
                for kind, win, msg in page.evaluate(CHECKS):
                    if win == "-":  # the sheet; the window behind it is checked below
                        self.fail("layout in the form: %s %s" % (kind, msg))
                shot(page, dev + "-jobs-form")
                page.locator("form.ask button[type=submit]").click()
                page.wait_for_timeout(600)
                jobs = live_jobs(page)
                self.assertEqual(len(jobs), 1)
                self.assertEqual(jobs[0]["status"], "applied")
                self.assertEqual(jobs[0]["url"], "https://example.com/jobs/1")
            stage = "saved" if phone else "applied"

            # it shows in its stage's tab; move it to Interview from the row
            page.locator(".win [role=tab]", has_text=stage.capitalize()).click()
            page.wait_for_timeout(300)
            page.locator(".item .row").first.click()
            page.wait_for_timeout(300)
            page.locator(".detail .jstage .selb").click()
            page.locator(".dd .mi", has_text="Interview").click()
            page.wait_for_timeout(500)
            self.assertEqual(live_jobs(page)[0]["status"], "interview")
            page.locator(".win [role=tab]", has_text="Interview").click()
            page.wait_for_timeout(300)
            page.locator(".item .row").first.click()
            page.wait_for_timeout(300)
            for kind, win, msg in page.evaluate(CHECKS):
                if win == "jobs" and kind != "edge":  # rows run edge to edge on purpose
                    self.fail("layout: %s %s" % (kind, msg))
            acts = page.locator(".detail .acts").bounding_box()
            self.assertLess(acts["height"], 50, "job actions wrap onto two rows")
            self.assertEqual(page.locator(".item .fit").first.inner_text(), "")
            shot(page, dev + "-jobs-interview")
            if not phone:
                page.screenshot(path=SHOTS + "/desk-taskbar.png", clip={"x": 880, "y": 780, "width": 400, "height": 40})

            # edit: change the notes
            page.locator(".detail button[aria-label='Edit job']").click()
            page.wait_for_timeout(400)
            page.fill("#job-notes", "Second round on Friday")
            page.locator("form.ask button[type=submit]").click()
            page.wait_for_timeout(500)
            self.assertEqual(live_jobs(page)[0]["notes"], "Second round on Friday")

            self.assertEqual(errors, [], errors)
            ctx.close()
            browser.close()

    def test_tracker_desktop(self):
        self.tracker(False)

    def test_tracker_phone(self):
        self.tracker(True)

    def test_feed_keeps_new_tab(self):
        with server() as url, sync_playwright() as pw:
            browser = pw.chromium.launch()
            ctx = new_context(browser, pw, False, url)
            page = ctx.new_page()
            page.goto(url + "/")
            page.wait_for_timeout(1200)
            open_window(page, "jobs")
            self.assertTrue(tab_names(page)[0].startswith("New"), tab_names(page))
            self.assertEqual(page.locator(".item .fit").first.inner_text(), "72")
            browser.close()


if __name__ == "__main__":
    unittest.main()
