#!/usr/bin/env python3
"""Connect a school Moodle privately on the server. Never pass credentials as command-line arguments."""

import argparse
import getpass
import sys
import warnings

import moodle


def hidden(prompt):
    # getpass normally falls back to echoed input if the terminal cannot hide it.
    with warnings.catch_warnings():
        warnings.simplefilter("error", getpass.GetPassWarning)
        try:
            return getpass.getpass(prompt)
        except getpass.GetPassWarning:
            raise moodle.MoodleError(
                "This terminal cannot hide input. Use a private terminal with hidden input support."
            ) from None


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--token", action="store_true", help="Prompt privately for an existing API token")
    mode.add_argument("--status", action="store_true", help="Check the saved connection without revealing credentials")
    mode.add_argument(
        "--disconnect", action="store_true", help="Remove the locally saved token (does not revoke it in Moodle)"
    )
    parser.add_argument("--site", help="The Moodle address, e.g. https://moodle.school.edu (asked when not set yet)")
    args = parser.parse_args(argv)
    try:
        if args.disconnect:
            moodle.KEY_FILE.unlink(missing_ok=True)
            print("Saved Moodle connection removed. Revoke the token in Moodle if needed.")
            return 0
        if args.status:
            info = moodle.handle({"action": "status"})
            print("Moodle connection verified." if info["connected"] else "Moodle is not connected.")
            return 0 if info["connected"] else 1
        if not sys.stdin.isatty():
            raise moodle.MoodleError("Run setup in an interactive private terminal; do not pipe credentials.")
        if args.site or not moodle.site():
            moodle.save_site(args.site or input("Moodle address (https://...): "))
        if args.token:
            token = hidden("Moodle API token (hidden): ").strip()
        else:
            username = input("Moodle username: ")
            password = hidden("Moodle password (hidden): ")
            try:
                token = moodle.login(username, password)
            finally:
                password = ""
        client = moodle.Client(token)
        info = client.info()
        moodle.save_token(token)
        print("Moodle connection verified and saved privately. Your password was not saved.")
        print("File downloads: " + ("enabled" if info.get("downloadfiles") else "not enabled by this service"))
        return 0
    except moodle.MoodleError as error:
        print(str(error), file=sys.stderr)
    except (OSError, EOFError, KeyboardInterrupt):
        # Never stringify transport errors: they can contain an authenticated URL.
        print("Moodle setup stopped; the connection could not be saved or checked.", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
