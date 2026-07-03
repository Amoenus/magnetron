import json
import sys
import unittest
from pathlib import Path
from unittest import mock

from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1] / "src"
sys.path.insert(0, str(ROOT))

from magnetron import app


class MagnetParsingTests(unittest.TestCase):
    def test_parse_hex_btih(self):
        parsed = app.parse_magnet(
            "magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567&dn=Example"
        )

        self.assertEqual(parsed.info_hash, "0123456789ABCDEF0123456789ABCDEF01234567")
        self.assertEqual(parsed.name, "Example")

    def test_parse_base32_btih(self):
        parsed = app.parse_magnet(
            "magnet:?xt=urn:btih:AERUKZ4JVPG66AJDIVTYTK6N54ASGRLH"
        )

        self.assertEqual(parsed.info_hash, "0123456789ABCDEF0123456789ABCDEF01234567")

    def test_reject_non_magnet(self):
        with self.assertRaises(ValueError):
            app.parse_magnet("https://example.test/file.torrent")


class DownstreamTests(unittest.TestCase):
    def test_bitmagnet_import_payload(self):
        settings = app.Settings(
            port=8080,
            base_url="https://torrent-intake.amoenus.cc",
            bitmagnet_url="http://bitmagnet:3333",
            bitmagnet_source="manual-web",
            qbittorrent_url="http://qbittorrent:8080",
            qbittorrent_api_key="secret",
            qbittorrent_category="discord-intake",
            qbittorrent_tags="discord-intake",
            default_action="index",
        )
        parsed = app.ParsedMagnet(
            magnet="magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567&dn=Example",
            info_hash="0123456789ABCDEF0123456789ABCDEF01234567",
            name="Example",
        )

        with mock.patch.object(app, "request") as request:
            request.return_value = app.DownstreamResult(True, 200, "ok")
            result = app.import_to_bitmagnet(settings, parsed)

        self.assertTrue(result.ok)
        method, url = request.call_args.args
        self.assertEqual(method, "POST")
        self.assertEqual(url, "http://bitmagnet:3333/import")
        payload = json.loads(request.call_args.kwargs["body"])
        self.assertEqual(payload["source"], "manual-web")
        self.assertEqual(payload["infoHash"], "0123456789ABCDEF0123456789ABCDEF01234567")
        self.assertEqual(payload["name"], "Example")

    def test_bitmagnet_import_payload_with_content_type_hint(self):
        settings = app.Settings(
            port=8080,
            base_url="https://torrent-intake.amoenus.cc",
            bitmagnet_url="http://bitmagnet:3333",
            bitmagnet_source="manual-web",
            qbittorrent_url="http://qbittorrent:8080",
            qbittorrent_api_key="secret",
            qbittorrent_category="discord-intake",
            qbittorrent_tags="discord-intake",
            default_action="index",
        )
        parsed = app.ParsedMagnet(
            magnet="magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567&dn=Example",
            info_hash="0123456789ABCDEF0123456789ABCDEF01234567",
            name="Example",
        )

        with mock.patch.object(app, "request") as request:
            request.return_value = app.DownstreamResult(True, 200, "ok")
            result = app.import_to_bitmagnet_with_hint(settings, parsed, "tv_show")

        self.assertTrue(result.ok)
        payload = json.loads(request.call_args.kwargs["body"])
        self.assertEqual(payload["contentType"], "tv_show")

    def test_bitmagnet_import_payload_with_external_id_hint(self):
        settings = app.Settings(
            port=8080,
            base_url="https://torrent-intake.amoenus.cc",
            bitmagnet_url="http://bitmagnet:3333",
            bitmagnet_source="manual-web",
            qbittorrent_url="http://qbittorrent:8080",
            qbittorrent_api_key="secret",
            qbittorrent_category="discord-intake",
            qbittorrent_tags="discord-intake",
            default_action="index",
        )
        parsed = app.ParsedMagnet(
            magnet="magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567&dn=Example",
            info_hash="0123456789ABCDEF0123456789ABCDEF01234567",
            name="Example",
        )

        with mock.patch.object(app, "request") as request:
            request.return_value = app.DownstreamResult(True, 200, "ok")
            result = app.import_to_bitmagnet_with_hint(settings, parsed, "tv_show", "tmdb", "89180")

        self.assertTrue(result.ok)
        payload = json.loads(request.call_args.kwargs["body"])
        self.assertEqual(payload["contentType"], "tv_show")
        self.assertEqual(payload["contentSource"], "tmdb")
        self.assertEqual(payload["contentId"], "89180")

    def test_qbittorrent_requires_api_key(self):
        settings = app.Settings(
            port=8080,
            base_url="https://torrent-intake.amoenus.cc",
            bitmagnet_url="http://bitmagnet:3333",
            bitmagnet_source="manual-web",
            qbittorrent_url="http://qbittorrent:8080",
            qbittorrent_api_key="",
            qbittorrent_category="discord-intake",
            qbittorrent_tags="discord-intake",
            default_action="index",
        )
        parsed = app.ParsedMagnet(
            magnet="magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567",
            info_hash="0123456789ABCDEF0123456789ABCDEF01234567",
            name="",
        )

        result = app.send_to_qbittorrent(settings, parsed)

        self.assertFalse(result.ok)
        self.assertIn("QBITTORRENT_API_KEY", result.message)


class ApiTests(unittest.TestCase):
    def test_healthz(self):
        client = TestClient(app.app)

        response = client.get("/healthz")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"status": "up"})

    def test_index_renders_server_template(self):
        client = TestClient(app.app)

        response = client.get("/")

        self.assertEqual(response.status_code, 200)
        self.assertIn('href="http://testserver/static/app.css"', response.text)
        self.assertIn("Submit magnet", response.text)
        self.assertIn("No submissions yet.", response.text)

    def test_static_css_serves_design_tokens(self):
        client = TestClient(app.app)

        response = client.get("/static/app.css")

        self.assertEqual(response.status_code, 200)
        self.assertIn("--color-surface-page", response.text)
        self.assertIn("--space-4", response.text)

    def test_magnet_intake_route(self):
        client = TestClient(app.app)

        with mock.patch.object(app, "request") as request:
            request.return_value = app.DownstreamResult(True, 200, "ok")
            response = client.post(
                "/api/intake/magnet",
                json={
                    "magnet": "magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567&dn=Example",
                    "action": "index",
                    "contentType": "movie",
                    "contentSource": "tmdb",
                    "contentId": "550",
                },
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["infoHash"], "0123456789ABCDEF0123456789ABCDEF01234567")
        payload = json.loads(request.call_args.kwargs["body"])
        self.assertEqual(payload["contentType"], "movie")
        self.assertEqual(payload["contentSource"], "tmdb")
        self.assertEqual(payload["contentId"], "550")


if __name__ == "__main__":
    unittest.main()
