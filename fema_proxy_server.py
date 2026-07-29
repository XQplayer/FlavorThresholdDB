from __future__ import annotations

import html
import json
import re
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, quote, urlparse
from urllib.request import Request, urlopen


HOST = "127.0.0.1"
PORT = 8787
BASE_URL = "https://www.femaflavor.org"
CACHE_PATH = Path(__file__).resolve().with_name("fema_flavor_cache.json")


def load_cache() -> dict[str, dict]:
    if not CACHE_PATH.exists():
        return {}
    try:
        return json.loads(CACHE_PATH.read_text(encoding="utf-8"))
    except Exception:
        return {}


def save_cache(cache: dict[str, dict]) -> None:
    CACHE_PATH.write_text(json.dumps(cache, ensure_ascii=False, indent=2), encoding="utf-8")


def fetch_text(url: str) -> str:
    req = Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urlopen(req, timeout=25) as resp:
        return resp.read().decode("utf-8", errors="replace")


def strip_tags(value: str) -> str:
    value = re.sub(r"<br\s*/?>", "\n", value, flags=re.I)
    value = re.sub(r"</p\s*>", "\n", value, flags=re.I)
    value = re.sub(r"<[^>]+>", " ", value)
    value = html.unescape(value)
    value = re.sub(r"[ \t\r\f\v]+", " ", value)
    value = re.sub(r"\n\s+", "\n", value)
    return value.strip()


def first_match(pattern: str, text: str, flags: int = re.S | re.I) -> str:
    match = re.search(pattern, text, flags)
    return match.group(1).strip() if match else ""


def parse_detail(detail_html: str, url: str) -> dict:
    title = first_match(r"<h1[^>]*>\s*([^<]*?)<strong>\s*<span>(.*?)</span>", detail_html)
    name_match = re.search(r"<h1[^>]*>\s*([^<]*?)<strong>\s*<span>(.*?)</span>", detail_html, re.S | re.I)
    fema_number = strip_tags(name_match.group(1)) if name_match else ""
    name = strip_tags(name_match.group(2)) if name_match else ""

    cas = first_match(
        r'field--name-field-cas[\s\S]*?<div class="field__item">([\s\S]*?)</div>',
        detail_html,
    )
    flavor_profile_raw = first_match(
        r'<div class="field[^"]*field--name-field-flavor-profile[^"]*"[^>]*>([\s\S]*?)</div>',
        detail_html,
    )
    jecfa = first_match(
        r'field--name-field-jecfa-number[\s\S]*?<div class="field__item">([\s\S]*?)</div>',
        detail_html,
    )

    return {
        "found": bool(flavor_profile_raw or name),
        "name": name,
        "cas": strip_tags(cas),
        "fema_number": fema_number,
        "jecfa_number": strip_tags(jecfa),
        "flavor_profile": strip_tags(flavor_profile_raw),
        "url": url,
        "source": "FEMA Flavor Library",
    }


def query_fema(cas_or_query: str) -> dict:
    query = cas_or_query.strip()
    if not query:
        return {"found": False, "error": "Missing query"}

    search_url = f"{BASE_URL}/flavor-library/search?fulltext={quote(query)}"
    search_html = fetch_text(search_url)
    href = first_match(r'<div class="views-row ingredient-item">\s*<a href="([^"]+)"', search_html)
    if not href:
        return {
            "found": False,
            "query": query,
            "search_url": search_url,
            "error": "No FEMA result",
        }

    detail_url = href if href.startswith("http") else BASE_URL + href
    detail_html = fetch_text(detail_url)
    result = parse_detail(detail_html, detail_url)
    result["query"] = query
    result["search_url"] = search_url
    return result


class Handler(BaseHTTPRequestHandler):
    cache = load_cache()

    def send_json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self) -> None:
        self.send_json(200, {"ok": True})

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/health":
            self.send_json(200, {"ok": True, "service": "fema_proxy"})
            return
        if parsed.path != "/fema":
            self.send_json(404, {"error": "Not found"})
            return

        params = parse_qs(parsed.query)
        query = (params.get("cas") or params.get("q") or [""])[0].strip()
        key = query.lower()
        if not query:
            self.send_json(400, {"found": False, "error": "Missing cas or q"})
            return

        if key in self.cache:
            self.send_json(200, {**self.cache[key], "cached": True})
            return

        try:
            result = query_fema(query)
            self.cache[key] = result
            save_cache(self.cache)
            self.send_json(200, {**result, "cached": False})
        except Exception as exc:
            self.send_json(502, {"found": False, "query": query, "error": str(exc)})

    def log_message(self, format: str, *args) -> None:
        return


def main() -> None:
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"FEMA proxy running at http://{HOST}:{PORT}")
    server.serve_forever()


if __name__ == "__main__":
    main()
