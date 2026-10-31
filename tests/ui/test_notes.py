"""Notes in a real browser: typing in the block editor saves the page (and survives a reload), and the whiteboard
draws a stroke, undoes and redoes it, and keeps it after a reload. Desktop and phone."""

import json
import unittest

from playwright.sync_api import sync_playwright

from harness import new_context, open_window, sample_data, server, shot


def stored(page, col):
    """Live documents of a collection on this device (deletes are kept as tombstones for sync)."""
    js = "c => Object.values(JSON.parse(localStorage.getItem('sos-db') || '{}')[c] || {}).filter(d => !d._d)"
    return page.evaluate(js, col)


class Notes(unittest.TestCase):
    def run_on(self, phone):
        dev = "phone" if phone else "desk"
        with server() as url, sync_playwright() as pw:
            browser = pw.chromium.launch()
            data = sample_data()
            data["pages"]["p2"] = {"title": "Cells", "kind": "note", "icon": "", "body": "First line", "_u": 1}
            ctx = new_context(browser, pw, phone, url, data=data, extra={"os-page": "p2"})
            page = ctx.new_page()
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.goto(url + "/")
            page.wait_for_timeout(1200)

            # block editor: add a line at the end of the page
            open_window(page, "notes")
            block = page.locator(".ce").filter(has_text="First line").first
            block.click()
            page.keyboard.press("End")
            page.keyboard.press("Enter")
            page.keyboard.type("Mitochondria make energy")
            page.wait_for_timeout(1200)
            body = next(p for p in stored(page, "pages") if p.get("title") == "Cells")["body"]
            self.assertIn("Mitochondria make energy", body)
            page.reload()
            page.wait_for_timeout(1200)
            self.assertTrue(page.get_by_text("Mitochondria make energy").count())
            shot(page, dev + "-test-editor")

            # whiteboard: draw, undo, redo, reload
            page.evaluate("localStorage.setItem('os-sub-notes', JSON.stringify('whiteboard'))")
            open_window(page, "notes")
            board = page.locator(".gbox.wbx canvas").last
            box = board.bounding_box()
            x, y = box["x"] + box["width"] / 3, box["y"] + box["height"] / 3
            page.mouse.move(x, y)
            page.mouse.down()
            for i in range(1, 12):
                page.mouse.move(x + i * 12, y + (i % 3) * 8, steps=2)
            page.mouse.up()
            page.wait_for_timeout(600)
            self.assertEqual(len(stored(page, "ink")), 1)
            page.locator("button[aria-label='Undo']").first.click()
            page.wait_for_timeout(300)
            self.assertEqual(len(stored(page, "ink")), 0)
            page.keyboard.press("Control+Shift+Z")
            page.locator(".gbox.wbx").focus()
            page.keyboard.press("Control+Shift+Z")
            page.wait_for_timeout(300)
            self.assertEqual(len(stored(page, "ink")), 1)
            page.reload()
            page.wait_for_timeout(1200)
            self.assertEqual(len(stored(page, "ink")), 1)
            shot(page, dev + "-test-whiteboard")

            self.assertEqual(errors, [], json.dumps(errors))
            browser.close()

    def test_desktop(self):
        self.run_on(False)

    def test_phone(self):
        self.run_on(True)


if __name__ == "__main__":
    unittest.main()
