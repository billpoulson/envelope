import unittest

from starlette.requests import Request

from app.services.audit import last_access_metadata_from_request, usage_details_from_headers


def _request_with_headers(headers: list[tuple[bytes, bytes]]) -> Request:
    return Request(
        {
            "type": "http",
            "method": "GET",
            "path": "/env/example",
            "headers": headers,
            "client": ("203.0.113.10", 4321),
        }
    )


class AuditUsageHeaderTests(unittest.TestCase):
    def test_usage_details_strip_control_chars_and_truncate(self) -> None:
        req = _request_with_headers(
            [
                (b"x-envelope-usage-name", (" deploy\x7f-prod " + ("x" * 200)).encode()),
                (b"x-envelope-usage-kind", b" github-action "),
                (b"x-envelope-usage-run", b"run-123"),
            ]
        )

        usage = usage_details_from_headers(req)

        self.assertIsNotNone(usage)
        assert usage is not None
        self.assertEqual(len(usage["name"]), 128)
        self.assertTrue(usage["name"].startswith("deploy-prod"))
        self.assertNotIn("\x7f", usage["name"])
        self.assertEqual(usage["kind"], "github-action")
        self.assertEqual(usage["run"], "run-123")

    def test_last_access_metadata_includes_source_and_sanitized_usage(self) -> None:
        req = _request_with_headers(
            [
                (b"x-envelope-usage-name", b"ci-fetch"),
                (b"user-agent", b"agent-value"),
            ]
        )

        meta = last_access_metadata_from_request(req)

        self.assertEqual(meta["last_accessed_usage_name"], "ci-fetch")
        self.assertIsNone(meta["last_accessed_usage_kind"])
        self.assertEqual(meta["last_accessed_ip"], "203.0.113.10")
        self.assertEqual(meta["last_accessed_user_agent"], "agent-value")


if __name__ == "__main__":
    unittest.main()
