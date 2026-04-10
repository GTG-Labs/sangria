"""Unit tests for Sangria Python SDK HTTP client."""

import json
from unittest.mock import AsyncMock, Mock, patch

import httpx
import pytest
from sangria_sdk._http import SangriaHTTPClient


class TestSangriaHTTPClient:
    """Test SangriaHTTPClient."""

    def test_init(self):
        """Test SangriaHTTPClient initialization."""
        client = SangriaHTTPClient(
            base_url="https://api.sangria.net",
            api_key="test_key_123",
            timeout_seconds=10.0
        )
        assert client._client.base_url == "https://api.sangria.net"
        assert client._client.headers["Authorization"] == "Bearer test_key_123"
        assert client._client.headers["Content-Type"] == "application/json"
        assert client._client.headers["Accept"] == "application/json"
        # Timeout is properly set (httpx wraps it in a Timeout object)

    def test_init_strips_trailing_slash(self):
        """Test that trailing slash is stripped from base URL."""
        client = SangriaHTTPClient(
            base_url="https://api.sangria.net/",
            api_key="test_key",
            timeout_seconds=8.0
        )
        assert client._client.base_url == "https://api.sangria.net"

    @pytest.mark.asyncio
    async def test_post_json_success(self):
        """Test successful POST JSON request."""
        client = SangriaHTTPClient(
            base_url="https://api.test.com",
            api_key="test_key",
            timeout_seconds=5.0
        )

        mock_response = AsyncMock()
        mock_response.status_code = 200
        mock_response.json = Mock(return_value={"success": True, "data": "test"})

        with patch.object(client._client, 'post', return_value=mock_response):
            result = await client.post_json("/test", {"param": "value"})

            assert result == {"success": True, "data": "test"}
            client._client.post.assert_called_once_with("/test", json={"param": "value"})

    @pytest.mark.asyncio
    async def test_post_json_4xx_no_raise(self):
        """Test that 4xx responses don't raise but return JSON."""
        client = SangriaHTTPClient(
            base_url="https://api.test.com",
            api_key="test_key",
            timeout_seconds=5.0
        )

        mock_response = AsyncMock()
        mock_response.status_code = 400
        mock_response.json = Mock(return_value={"error": "Bad request", "error_reason": "invalid_data"})

        with patch.object(client._client, 'post', return_value=mock_response):
            result = await client.post_json("/test", {"invalid": "data"})

            assert result == {"error": "Bad request", "error_reason": "invalid_data"}
            mock_response.raise_for_status.assert_not_called()

    @pytest.mark.asyncio
    async def test_post_json_5xx_raises(self):
        """Test that 5xx responses raise HTTPError."""
        client = SangriaHTTPClient(
            base_url="https://api.test.com",
            api_key="test_key",
            timeout_seconds=5.0
        )

        mock_response = AsyncMock()
        mock_response.status_code = 500
        mock_response.raise_for_status = Mock(side_effect=httpx.HTTPStatusError(
            "500 Internal Server Error", request=None, response=mock_response
        ))

        with patch.object(client._client, 'post', return_value=mock_response):
            with pytest.raises(httpx.HTTPStatusError):
                await client.post_json("/test", {"data": "test"})

    @pytest.mark.asyncio
    async def test_post_json_handles_various_4xx_codes(self):
        """Test that various 4xx codes are handled without raising."""
        client = SangriaHTTPClient(
            base_url="https://api.test.com",
            api_key="test_key",
            timeout_seconds=5.0
        )

        for status_code in [400, 401, 403, 404, 422, 429]:
            mock_response = AsyncMock()
            mock_response.status_code = status_code
            mock_response.json = Mock(return_value={"error": f"Error {status_code}"})

            with patch.object(client._client, 'post', return_value=mock_response):
                result = await client.post_json("/test", {"data": "test"})
                assert result == {"error": f"Error {status_code}"}

    @pytest.mark.asyncio
    async def test_close(self):
        """Test client close method."""
        client = SangriaHTTPClient(
            base_url="https://api.test.com",
            api_key="test_key",
            timeout_seconds=5.0
        )

        with patch.object(client._client, 'aclose') as mock_close:
            await client.close()
            mock_close.assert_called_once()

    @pytest.mark.asyncio
    async def test_post_json_with_complex_payload(self):
        """Test POST JSON with complex payload."""
        client = SangriaHTTPClient(
            base_url="https://api.test.com",
            api_key="test_key",
            timeout_seconds=5.0
        )

        complex_payload = {
            "amount": 25.99,
            "resource": "/premium/article/123",
            "metadata": {
                "user_id": "user_456",
                "session_id": "sess_789",
                "tags": ["premium", "article"]
            },
            "timestamp": "2024-01-01T12:00:00Z"
        }

        mock_response = AsyncMock()
        mock_response.status_code = 201
        mock_response.json = Mock(return_value={"payment_id": "pay_123", "status": "created"})

        with patch.object(client._client, 'post', return_value=mock_response):
            result = await client.post_json("/payments", complex_payload)

            assert result == {"payment_id": "pay_123", "status": "created"}
            client._client.post.assert_called_once_with("/payments", json=complex_payload)

    @pytest.mark.asyncio
    async def test_post_json_empty_response_body(self):
        """Test POST JSON with empty response body."""
        client = SangriaHTTPClient(
            base_url="https://api.test.com",
            api_key="test_key",
            timeout_seconds=5.0
        )

        mock_response = AsyncMock()
        mock_response.status_code = 204
        mock_response.json = Mock(return_value={})

        with patch.object(client._client, 'post', return_value=mock_response):
            result = await client.post_json("/test", {"data": "test"})
            assert result == {}