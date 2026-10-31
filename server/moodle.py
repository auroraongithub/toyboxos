"""Private, read-only Moodle client for one school site. Credentials never enter the app database.
The site address lives in moodle.json {"site": "https://..."} next to the token (or SOS_MOODLE_SITE); moodle_setup.py asks for it."""

import hashlib
import json
import os
from pathlib import Path
import re
import tempfile
import urllib.error
import urllib.parse
import urllib.request

BASE = Path(os.environ.get("SOS_HOME") or Path(__file__).resolve().parent)
CONF = BASE / "moodle.json"


def site():
    s = os.environ.get("SOS_MOODLE_SITE", "")
    if not s and CONF.exists():
        try:
            s = json.loads(CONF.read_text()).get("site", "")
        except (OSError, ValueError):
            s = ""
    return s.rstrip("/") if isinstance(s, str) and s.startswith("https://") else ""


def save_site(url):
    url = url.strip().rstrip("/")
    if not re.fullmatch(r"https://[A-Za-z0-9.-]+(:[0-9]+)?(/[A-Za-z0-9._~/-]*)?", url):
        raise MoodleError("Enter the Moodle address as https://your.school.site")
    _atomic_write(CONF, json.dumps({"site": url}).encode())


KEY_FILE = BASE / "moodle_key.txt"
DOWNLOADS = BASE / "data" / "moodle"
MAX_JSON = 8 * 1024 * 1024
MAX_FILE = 30 * 1024 * 1024
READ_FUNCTIONS = {
    "core_webservice_get_site_info",
    "core_enrol_get_users_courses",
    "core_course_get_contents",
    "mod_assign_get_assignments",
    "mod_forum_get_forums_by_courses",
    "mod_forum_get_forum_discussions",
    "mod_forum_get_discussion_posts",
}
SECRET_KEYS = {"token", "wstoken", "privatetoken", "password", "sesskey", "authtoken"}


class MoodleError(ValueError):
    """Only fixed, credential-free messages may cross the HTTP boundary."""


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        # File URLs contain credentials. Even a same-site redirect may lead off site.
        return None


def _request(request, limit):
    try:
        with urllib.request.build_opener(NoRedirect).open(request, timeout=40) as response:
            data = response.read(limit + 1)
            if len(data) > limit:
                raise MoodleError("Moodle response exceeds the size limit.")
            return data, response.headers.get_content_type()
    except urllib.error.HTTPError as error:
        error.close()
        raise MoodleError("Moodle rejected the request or redirected it; check the connection.") from None
    except (OSError, TimeoutError):
        raise MoodleError("Could not reach Moodle. Try again later.") from None


def _check_error(data):
    if not isinstance(data, dict) or not any(k in data for k in ("exception", "error", "errorcode")):
        return
    code = data.get("errorcode")
    if code in ("invalidtoken", "invalidlogin", "userdeleted", "requireloginerror"):
        raise MoodleError("Moodle sign-in failed or the token expired. Run moodle_setup.py again.")
    if code in ("accessexception", "webservice_access_exception", "nopermissions", "wsfunctionnotavailable"):
        raise MoodleError("This Moodle account or service does not permit that operation.")
    raise MoodleError("Moodle could not complete that request. Check the account and API permissions.")


def _json_request(path, fields):
    if not site():
        raise MoodleError("No Moodle site set yet. Run moodle_setup.py on the server.")
    request = urllib.request.Request(
        site() + path,
        data=urllib.parse.urlencode(fields).encode(),
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    data, _ = _request(request, MAX_JSON)
    try:
        result = json.loads(data)
    except (ValueError, UnicodeError):
        raise MoodleError("Moodle returned an unexpected response; browser sign-in may be required.") from None
    _check_error(result)
    return result


def login(username, password):
    """Exchange a login for a token over HTTPS; callers must not persist the password."""
    if not username.strip() or not password:
        raise MoodleError("Enter your Moodle username and password.")
    data = _json_request(
        "/login/token.php", {"username": username.strip(), "password": password, "service": "moodle_mobile_app"}
    )
    token = data.get("token") if isinstance(data, dict) else None
    if not isinstance(token, str) or not re.fullmatch(r"[A-Za-z0-9]{16,256}", token):
        raise MoodleError("Moodle did not issue an API token. An approved token or browser sign-in may be required.")
    return token


def _atomic_write(path, data):
    """Create owner-only files and replace atomically, including when overwriting an existing file."""
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as output:
            temporary = Path(output.name)
            os.chmod(temporary, 0o600)
            output.write(data)
        os.replace(temporary, path)
    finally:
        if temporary and temporary.exists():
            temporary.unlink()


def save_token(token, path=None):
    """A failed login never replaces the connection; call only after account verification."""
    _atomic_write(Path(path or KEY_FILE), (token + "\n").encode())


def _positive(body, name):
    value = body.get(name)
    if isinstance(value, bool) or not re.fullmatch(r"[1-9][0-9]{0,9}", str(value)):
        raise MoodleError(name + " must be a positive integer.")
    return int(value)


def _page(body):
    value = body.get("page", 0)
    if isinstance(value, bool) or not re.fullmatch(r"[0-9]{1,5}", str(value)):
        raise MoodleError("page must be a non-negative integer.")
    return int(value)


class Client:
    def __init__(self, token):
        if not isinstance(token, str) or not re.fullmatch(r"[A-Za-z0-9]{16,256}", token):
            raise MoodleError("Invalid Moodle token. Run moodle_setup.py again.")
        self.token = token

    @classmethod
    def configured(cls):
        try:
            token = KEY_FILE.read_text(encoding="utf-8").strip()
        except FileNotFoundError:
            raise MoodleError("Moodle is not connected. Run moodle_setup.py on the home server.") from None
        except OSError:
            raise MoodleError("Could not read the private Moodle connection file.") from None
        return cls(token)

    def public(self, value):
        """Remove credentials from all output, including nested file URLs and HTML."""
        if isinstance(value, dict):
            return {self.public(k): self.public(v) for k, v in value.items() if k.lower() not in SECRET_KEYS}
        if isinstance(value, list):
            return [self.public(v) for v in value]
        if isinstance(value, str):
            value = value.replace(self.token, "[redacted]")
            return re.sub(
                r"(?i)((?:[?&]|&amp;)(?:token|wstoken|privatetoken|password|sesskey|authtoken)=)[^\s\"'<> &]*",
                r"\1[redacted]",
                value,
            )
        return value

    def call(self, function, fields=None):
        if function not in READ_FUNCTIONS:
            raise MoodleError("Only the documented Moodle read operations are supported.")
        return _json_request(
            "/webservice/rest/server.php",
            {**(fields or {}), "wstoken": self.token, "wsfunction": function, "moodlewsrestformat": "json"},
        )

    def info(self):
        info = self.call("core_webservice_get_site_info")
        if not isinstance(info, dict) or not isinstance(info.get("userid"), int):
            raise MoodleError("Moodle returned invalid account information.")
        return info

    def courses(self):
        return self.call("core_enrol_get_users_courses", {"userid": self.info()["userid"], "returnusercount": 0})

    def require_course(self, course):
        if not any(item.get("id") == course for item in self.courses()):
            raise MoodleError("Choose a course returned by your enrolled-course list.")

    def contents(self, course):
        self.require_course(course)
        return self.call("core_course_get_contents", {"courseid": course})

    def forums(self, course):
        self.require_course(course)
        return self.call("mod_forum_get_forums_by_courses", {"courseids[0]": course})

    def require_forum(self, course, forum):
        if not any(item.get("id") == forum for item in self.forums(course)):
            raise MoodleError("Choose a forum returned by this course's forum list.")

    def discussions(self, course, forum, page):
        self.require_forum(course, forum)
        return self.call("mod_forum_get_forum_discussions", {"forumid": forum, "page": page, "perpage": 20})

    def file_entry(self, body):
        course, module = _positive(body, "course"), _positive(body, "module")
        index = body.get("file", 0)
        if isinstance(index, bool) or not re.fullmatch(r"[0-9]{1,5}", str(index)):
            raise MoodleError("file must be a non-negative index from the module's file contents.")
        for section in self.contents(course):
            for item in section.get("modules", []):
                if item.get("id") == module:
                    files = [entry for entry in item.get("contents", []) if entry.get("type") == "file"]
                    if int(index) < len(files):
                        return files[int(index)]
        raise MoodleError("That module file was not found in the course contents.")

    def download(self, body):
        entry = self.file_entry(body)
        url = entry.get("fileurl", "")
        parsed = urllib.parse.urlsplit(url)
        # Accept only the exact Moodle web-service file route, with no caller-chosen URL or redirect.
        if (
            parsed.scheme != "https"
            or parsed.netloc != urllib.parse.urlsplit(site()).netloc
            or not parsed.path.startswith("/webservice/pluginfile.php/")
        ):
            raise MoodleError("Only files served directly by the Moodle site can be downloaded.")
        query = urllib.parse.parse_qsl(parsed.query, keep_blank_values=True)
        if parsed.fragment or any(k not in {"forcedownload", "offline", "token"} for k, _ in query):
            raise MoodleError("Unexpected Moodle file URL parameters.")
        query = [(k, v) for k, v in query if k != "token"]
        url = urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, parsed.path, urllib.parse.urlencode(query), ""))
        request = urllib.request.Request(url + ("&" if query else "?") + urllib.parse.urlencode({"token": self.token}))
        data, ctype = _request(request, MAX_FILE)
        if ctype == "application/json":
            try:
                result = json.loads(data)
            except (ValueError, UnicodeError):
                result = None
            _check_error(result)
        DOWNLOADS.mkdir(mode=0o700, parents=True, exist_ok=True)
        os.chmod(DOWNLOADS, 0o700)
        # Account, URL, and revision determine a stable private ID; re-downloads replace atomically.
        fid = hashlib.sha256(
            (str(self.info()["userid"]) + url + str(entry.get("timemodified", 0))).encode()
        ).hexdigest()
        name = str(entry.get("filename") or "material").replace("\\", "/").rsplit("/", 1)[-1][:200]
        meta = self.public({"id": fid, "name": name, "size": len(data), "type": ctype})
        for suffix, content in (("", data), (".json", json.dumps(meta).encode())):
            _atomic_write(DOWNLOADS / (fid + suffix), content)
        return meta


def handle(body):
    """POST /api/moodle (normal sync bearer auth); never accepts credentials or arbitrary functions."""
    if not isinstance(body, dict):
        raise MoodleError("Expected a Moodle request object.")
    if any(str(k).lower() in SECRET_KEYS | {"url", "function", "wsfunction", "site"} for k in body):
        raise MoodleError("Use private terminal setup for credentials; request only documented Moodle actions.")
    action = body.get("action", "status")
    if not isinstance(action, str) or action not in {
        "site",
        "status",
        "courses",
        "contents",
        "assignments",
        "forums",
        "discussions",
        "posts",
        "download",
    }:
        raise MoodleError(
            "Unknown Moodle action. Use status, courses, contents, assignments, forums, discussions, posts or download."
        )
    if action == "site":  # no network: the address for "Open in Moodle" links
        return {"site": site()}
    if action == "status" and not KEY_FILE.exists():
        return {"connected": False, "site": site()}
    client = Client.configured()
    if action == "status":
        info = client.info()
        out = {
            "connected": True,
            "site": site(),
            "label": info.get("sitename", "") or "Moodle",
            "userid": info["userid"],
            "name": info.get("fullname", ""),
            "downloadfiles": bool(info.get("downloadfiles")),
            "functions": [f["name"] for f in info.get("functions", []) if f.get("name") in READ_FUNCTIONS],
        }
    elif action == "courses":
        out = client.courses()
    elif action == "contents":
        out = client.contents(_positive(body, "course"))
    elif action == "assignments":
        course = _positive(body, "course")
        client.require_course(course)
        out = client.call("mod_assign_get_assignments", {"courseids[0]": course})
    elif action == "forums":
        out = client.forums(_positive(body, "course"))
    elif action in {"discussions", "posts"}:
        discussions = client.discussions(_positive(body, "course"), _positive(body, "forum"), _page(body))
        if action == "posts":
            discussion = _positive(body, "discussion")
            if not any(d.get("discussion") == discussion for d in discussions.get("discussions", [])):
                raise MoodleError("Choose a discussion on the requested forum page.")
            out = client.call("mod_forum_get_discussion_posts", {"discussionid": discussion})
        else:
            out = discussions
    else:
        out = client.download(body)
    return client.public(out)


def read_file(fid):
    """Bytes are available only through the authenticated Moodle download endpoint."""
    if not re.fullmatch(r"[a-f0-9]{64}", fid):
        raise MoodleError("No such Moodle download.")
    try:
        metadata = json.loads((DOWNLOADS / (fid + ".json")).read_text(encoding="utf-8"))
        data = (DOWNLOADS / fid).read_bytes()
    except (OSError, ValueError):
        raise MoodleError("No such Moodle download. Download the material again.") from None
    return data, metadata
