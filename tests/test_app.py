import json
import sys
import tempfile
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

        with mock.patch.object(app, "query_bitmagnet_history", return_value=[]):
            response = client.get("/")

        self.assertEqual(response.status_code, 200)
        self.assertIn('href="http://testserver/static/app.css"', response.text)
        self.assertIn("Submit magnet", response.text)
        self.assertIn("No submissions yet.", response.text)
        self.assertIn("hx-get", response.text)

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

    def test_bitmagnet_history_maps_discovered_metadata(self):
        graphql_response = {
            "data": {
                "torrentContent": {
                    "search": {
                        "items": [
                            {
                                "infoHash": "0123456789ABCDEF0123456789ABCDEF01234567",
                                "contentType": "movie",
                                "contentSource": "tmdb",
                                "contentId": "550",
                                "title": "Example Release",
                                "updatedAt": "2026-01-01T00:00:00Z",
                                "seeders": 12,
                                "leechers": 3,
                                "videoResolution": "V1080p",
                                "videoSource": "WEB",
                                "videoCodec": "x265",
                                "torrent": {
                                    "name": "Example Torrent",
                                    "magnetUri": "magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567",
                                },
                                "content": {
                                    "type": "movie",
                                    "source": "tmdb",
                                    "id": "550",
                                    "title": "Fight Club",
                                    "releaseYear": 1999,
                                    "metadataSource": {"key": "tmdb", "name": "TMDB"},
                                },
                            }
                        ]
                    }
                }
            }
        }
        settings = app.Settings(
            port=8080,
            base_url="http://localhost:8080",
            bitmagnet_url="http://bitmagnet:3333",
            bitmagnet_source="manual-web",
            qbittorrent_url="http://qbittorrent:8080",
            qbittorrent_api_key="",
            qbittorrent_category="discord-intake",
            qbittorrent_tags="discord-intake",
            default_action="index",
        )

        with mock.patch.object(app, "request_json", return_value=graphql_response) as request_json:
            result = app.query_bitmagnet_history(settings)

        self.assertEqual(result[0].discovered_title, "Fight Club")
        self.assertEqual(result[0].content_source, "tmdb")
        self.assertEqual(result[0].content_id, "550")
        self.assertEqual(result[0].seeders, 12)
        variables = request_json.call_args.args[2]["variables"]
        self.assertEqual(variables["input"]["facets"]["torrentSource"]["filter"], ["manual-web"])

    def test_recent_fragment_renders_bitmagnet_metadata(self):
        client = TestClient(app.app)
        item = app.HistoryItem(
            timestamp="2026-01-01T00:00:00Z",
            action="indexed",
            content_type="movie",
            content_source="tmdb",
            content_id="550",
            magnet="magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567",
            info_hash="0123456789ABCDEF0123456789ABCDEF01234567",
            name="Example Torrent",
            discovered_title="Fight Club",
            discovered_source="TMDB",
            discovered_id="550",
            release_year="1999",
            video_summary="V1080p WEB x265",
            seeders=12,
            leechers=3,
            bitmagnet=app.DownstreamResult(True, 200, "found in bitmagnet"),
            qbittorrent=None,
            source="bitmagnet",
        )

        with mock.patch.object(app, "query_bitmagnet_history", return_value=[item]):
            response = client.get("/fragments/recent-submissions")

        self.assertEqual(response.status_code, 200)
        self.assertIn("Fight Club", response.text)
        self.assertIn("V1080p WEB x265", response.text)
        self.assertIn("Edit", response.text)

    def test_edit_prefills_submit_form_from_history(self):
        client = TestClient(app.app)
        item = app.HistoryItem(
            timestamp="2026-01-01T00:00:00Z",
            action="indexed",
            content_type="movie",
            content_source="tmdb",
            content_id="550",
            magnet="magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567",
            info_hash="0123456789ABCDEF0123456789ABCDEF01234567",
            name="Example Torrent",
            discovered_title="Fight Club",
            discovered_source="TMDB",
            discovered_id="550",
            release_year="1999",
            video_summary="",
            seeders=None,
            leechers=None,
            bitmagnet=None,
            qbittorrent=None,
            source="bitmagnet",
        )

        with mock.patch.object(app, "query_bitmagnet_history", return_value=[item]):
            response = client.get("/?editInfoHash=0123456789ABCDEF0123456789ABCDEF01234567")

        self.assertEqual(response.status_code, 200)
        self.assertIn("Edit and resubmit", response.text)
        self.assertIn(item.magnet, response.text)
        self.assertIn('value="550"', response.text)

    def test_ui_settings_persist_only_unlocked_fields(self):
        with tempfile.TemporaryDirectory() as tmp:
            config_path = str(Path(tmp) / "config.json")
            env = {
                "MAGNETRON_CONFIG_PATH": config_path,
                "BITMAGNET_URL": "http://env-bitmagnet:3333",
            }
            form = {
                "bitmagnet_url": "http://ui-bitmagnet:3333",
                "bitmagnet_source": "manual-web-ui",
                "qbittorrent_url": "http://ui-qbt:8080",
                "qbittorrent_api_key": "secret",
                "qbittorrent_category": "movies",
                "qbittorrent_tags": "magnetron",
                "default_action": "both",
            }

            with mock.patch.dict(app.os.environ, env, clear=True):
                app.update_persisted_config(form)
                settings = app.current_settings()

            persisted = json.loads(Path(config_path).read_text())
            self.assertNotIn("bitmagnet_url", persisted)
            self.assertEqual(settings.bitmagnet_url, "http://env-bitmagnet:3333")
            self.assertEqual(settings.bitmagnet_source, "manual-web-ui")
            self.assertEqual(settings.default_action, "both")

    def test_settings_page_locks_env_configured_fields(self):
        client = TestClient(app.app)
        with tempfile.TemporaryDirectory() as tmp:
            env = {
                "MAGNETRON_CONFIG_PATH": str(Path(tmp) / "config.json"),
                "BITMAGNET_URL": "http://env-bitmagnet:3333",
            }
            with mock.patch.dict(app.os.environ, env, clear=True):
                response = client.get("/settings")

        self.assertEqual(response.status_code, 200)
        self.assertIn("Locked by BITMAGNET_URL", response.text)
        self.assertIn("Save settings", response.text)


if __name__ == "__main__":
    unittest.main()
