"""Opens every window, every tab and every options menu on desktop and phone, and fails on a page error or a layout
problem (see layout_checks.js) that isn't in ALLOWED. Screenshots land in build/ui-shots/.

    python -m unittest discover -s tests/ui -p "test_*.py"
"""

import re
import unittest

from playwright.sync_api import sync_playwright

from harness import CHECKS, new_context, open_window, server, shot

WINDOWS = ["today", "plan", "notes", "buddy", "money", "jobs", "sync", "nijika", "theme", "profile", "moodle", "models"]
# deliberate designs that the generic checks flag: (device, kind, window, start of the description)
ALLOWED = [
    (".*", "edge", "today", "(Open the timer|Start focus)"),  # the timer strip is a full-width band
    (".*", "edge", "jobs", ""),  # job rows run edge to edge
]
MENU_LABEL = re.compile(r"options|settings|more|menu", re.I)


def allowed(dev, kind, win, msg):
    return any(re.match(d, dev) and k == kind and w == win and re.match(m, msg) for d, k, w, m in ALLOWED)


class Windows(unittest.TestCase):
    def test_every_window_tab_and_menu(self):
        problems = []
        with server() as url, sync_playwright() as pw:
            browser = pw.chromium.launch()
            for phone in (False, True):
                dev = "phone" if phone else "desk"
                ctx = new_context(browser, pw, phone, url)
                page = ctx.new_page()
                errors = []
                page.on("pageerror", lambda e: errors.append(str(e)))
                page.goto(url + "/")
                page.wait_for_timeout(1500)

                def check(label):
                    for kind, win, msg in page.evaluate(CHECKS):
                        if not allowed(dev, kind, win, msg):
                            problems.append("%s %s %s: %s" % (dev, label, kind, msg))

                for win in WINDOWS:
                    open_window(page, win)
                    tabs = page.locator(".win [role=tab]")
                    for i in range(max(1, tabs.count())):
                        if tabs.count():
                            tabs.nth(i).click()
                            page.wait_for_timeout(400)
                        label = win + (":" + tabs.nth(i).inner_text().strip() if tabs.count() else "")
                        check(label)
                        shot(page, "%s-%s" % (dev, re.sub(r"\W+", "-", label)))
                        menus = page.locator(".win button[aria-label]").evaluate_all(
                            "bs => bs.filter(b => b.getBoundingClientRect().width > 0).map(b => b.getAttribute('aria-label'))"
                        )
                        for name in [m for m in dict.fromkeys(menus) if MENU_LABEL.search(m)][:6]:
                            page.locator(".win button[aria-label='%s']" % name.replace("'", "\\'")).first.click()
                            page.wait_for_timeout(400)
                            if page.locator(".sheet, .pop2").count():
                                check(label + " > " + name)
                            page.keyboard.press("Escape")
                            page.wait_for_timeout(250)
                problems += ["%s page error: %s" % (dev, e) for e in errors]
                ctx.close()
            browser.close()
        self.assertEqual(problems, [], "\n".join(problems))


if __name__ == "__main__":
    unittest.main()
