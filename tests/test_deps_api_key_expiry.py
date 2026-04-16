"""Unit tests for API key expiry comparison (naive vs aware datetimes from DB drivers)."""

import unittest
from datetime import datetime, timedelta, timezone

from app.deps import _api_key_expired


class ApiKeyExpiredHelperTests(unittest.TestCase):
    def test_none_never_expired(self) -> None:
        self.assertFalse(_api_key_expired(None))

    def test_naive_utc_in_past_is_expired(self) -> None:
        past = (datetime.now(timezone.utc) - timedelta(minutes=1)).replace(tzinfo=None)
        self.assertTrue(_api_key_expired(past))

    def test_naive_utc_in_future_not_expired(self) -> None:
        fut = (datetime.now(timezone.utc) + timedelta(hours=24)).replace(tzinfo=None)
        self.assertFalse(_api_key_expired(fut))

    def test_aware_future_not_expired(self) -> None:
        fut = datetime.now(timezone.utc) + timedelta(days=1)
        self.assertFalse(_api_key_expired(fut))

    def test_aware_past_expired(self) -> None:
        past = datetime.now(timezone.utc) - timedelta(seconds=1)
        self.assertTrue(_api_key_expired(past))


if __name__ == "__main__":
    unittest.main()
