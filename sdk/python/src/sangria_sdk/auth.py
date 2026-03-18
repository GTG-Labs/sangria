from __future__ import annotations


def api_key_header(api_key: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {api_key}"}
