"""Tests for sangria_sdk._http module."""

from unittest.mock import AsyncMock, Mock, patch

import httpx
import pytest
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', '..', 'sdk', 'python', 'src'))

from sangria_sdk._http import SangriaHTTPClient


class TestSangriaHTTPClient:
    """Test SangriaHTTPClient class."""

    def test_initialization(self):
        """Test HTTP client initialization."""
        client = SangriaHTTPClient(
            base_url="https://api.sangria.net",
            api_key="sk_test_123",
            timeout_seconds=10.0
        )

        # Verify the httpx client was created with correct parameters
        assert client._client.base_url == "https://api.sangria.net"
        assert client._client.timeout.read == 10.0

        # Check headers
        headers = client._client.headers
        assert headers["Authorization"] == "Bearer sk_test_123"
        assert headers["Content-Type"] == "application/json"
        assert headers["Accept"] == "application/json"

    def test_initialization_strips_trailing_slash(self):
        """Test that base_url trailing slash is stripped."""
        client = SangriaHTTPClient(
            base_url="https://api.sangria.net/",
            api_key="sk_test_456"
        )
        assert client._client.base_url == "https://api.sangria.net"

    def test_initialization_default_timeout(self):
        """Test initialization with default timeout."""
        client = SangriaHTTPClient(
            base_url="https://api.test.com",
            api_key="sk_test_789"
        )
        assert client._client.timeout.read == 8.0

    @pytest.mark.asyncio
    async def test_post_json_success(self):
        """Test successful post_json request."""
        client = SangriaHTTPClient(
            base_url="https://api.test.com",
            api_key="sk_test_123"
        )

        # Mock response
        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"success": True, "data": "test"}

        with patch.object(client._client, 'post', new_callable=AsyncMock) as mock_post:
            mock_post.return_value = mock_response

            result = await client.post_json(
                "/api/test",
                {"key": "value"}
            )

            assert result == {"success": True, "data": "test"}
            mock_post.assert_called_once_with("/api/test", json={"key": "value"})
            mock_response.json.assert_called_once()

    @pytest.mark.asyncio
    async def test_post_json_4xx_response(self):
        """Test post_json with 4xx response (should not raise)."""
        client = SangriaHTTPClient(
            base_url="https://api.test.com",
            api_key="sk_test_123"
        )

        # Mock 4xx response
        mock_response = Mock()
        mock_response.status_code = 402
        mock_response.json.return_value = {"error": "Payment required"}

        with patch.object(client._client, 'post', new_callable=AsyncMock) as mock_post:
            mock_post.return_value = mock_response

            result = await client.post_json(
                "/api/payment",
                {"amount": 10.0}
            )

            # 4xx responses should return the JSON without raising
            assert result == {"error": "Payment required"}

    @pytest.mark.asyncio
    async def test_post_json_5xx_response_raises(self):
        """Test post_json with 5xx response (should raise)."""
        client = SangriaHTTPClient(
            base_url="https://api.test.com",
            api_key="sk_test_123"
        )

        # Mock 5xx response
        mock_response = Mock()
        mock_response.status_code = 500
        mock_response.raise_for_status.side_effect = httpx.HTTPStatusError(
            "500 Server Error", request=Mock(), response=mock_response
        )

        with patch.object(client._client, 'post', new_callable=AsyncMock) as mock_post:
            mock_post.return_value = mock_response

            with pytest.raises(httpx.HTTPStatusError):
                await client.post_json(
                    "/api/test",
                    {"data": "test"}
                )

            mock_response.raise_for_status.assert_called_once()

    @pytest.mark.asyncio
    async def test_post_json_network_error(self):
        """Test post_json with network error."""
        client = SangriaHTTPClient(
            base_url="https://api.test.com",
            api_key="sk_test_123"
        )

        with patch.object(client._client, 'post', new_callable=AsyncMock) as mock_post:
            mock_post.side_effect = httpx.ConnectError("Connection failed")

            with pytest.raises(httpx.ConnectError):
                await client.post_json(
                    "/api/test",
                    {"data": "test"}
                )

    @pytest.mark.asyncio
    async def test_close(self):
        """Test close method."""
        client = SangriaHTTPClient(
            base_url="https://api.test.com",
            api_key="sk_test_123"
        )

        with patch.object(client._client, 'aclose', new_callable=AsyncMock) as mock_close:
            await client.close()
            mock_close.assert_called_once()

    @pytest.mark.asyncio
    async def test_multiple_requests(self):
        """Test multiple requests with same client."""
        client = SangriaHTTPClient(
            base_url="https://api.test.com",
            api_key="sk_test_123"
        )

        # Mock responses for multiple calls
        mock_response_1 = Mock()
        mock_response_1.status_code = 200
        mock_response_1.json.return_value = {"request": 1}

        mock_response_2 = Mock()
        mock_response_2.status_code = 201
        mock_response_2.json.return_value = {"request": 2}

        with patch.object(client._client, 'post', new_callable=AsyncMock) as mock_post:
            mock_post.side_effect = [mock_response_1, mock_response_2]

            result1 = await client.post_json("/api/test1", {"data": 1})
            result2 = await client.post_json("/api/test2", {"data": 2})

            assert result1 == {"request": 1}
            assert result2 == {"request": 2}
            assert mock_post.call_count == 2

    @pytest.mark.asyncio
    async def test_empty_payload(self):
        """Test post_json with empty payload."""
        client = SangriaHTTPClient(
            base_url="https://api.test.com",
            api_key="sk_test_123"
        )

        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"received": "empty"}

        with patch.object(client._client, 'post', new_callable=AsyncMock) as mock_post:
            mock_post.return_value = mock_response

            result = await client.post_json("/api/test", {})

            assert result == {"received": "empty"}
            mock_post.assert_called_once_with("/api/test", json={})

    def test_api_key_formats(self):
        """Test various API key formats in headers."""
        # Test with different API key formats
        test_cases = [
            "sk_test_123",
            "sk_live_456",
            "test_key",
            "very_long_api_key_with_many_characters_12345"
        ]

        for api_key in test_cases:
            client = SangriaHTTPClient(
                base_url="https://api.test.com",
                api_key=api_key
            )

            expected_auth = f"Bearer {api_key}"
            assert client._client.headers["Authorization"] == expected_auth