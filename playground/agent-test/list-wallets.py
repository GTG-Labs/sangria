"""
List ALL wallets visible to your CDP credentials — both the new EVM Accounts API
and the old v1 Wallets API (which is where portal-created wallets live).

Usage:
  cd playground
  uv run python agent-test/list-wallets.py

If you get rate limited on the v1 API, wait a couple minutes and try again.
"""

import asyncio
import os
import sys

import httpx

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from wallet import get_cdp_client
from cdp.auth.utils.jwt import generate_jwt, JwtOptions


async def list_new_evm_accounts():
    client = get_cdp_client()
    try:
        result = await client.evm.list_accounts()
        print(f"Found {len(result.accounts)} accounts:")
        for a in result.accounts:
            print(f"  {a.address}")
    finally:
        await client.close()


async def list_v1_wallets():
    api_key = os.environ["CDP_API_KEY"]
    api_secret = os.environ.get("CDP_SECRET_KEY") or os.environ.get("CDP_API_SECRET", "")

    token = generate_jwt(JwtOptions(
        api_key_id=api_key,
        api_key_secret=api_secret,
        request_method="GET",
        request_host="api.cdp.coinbase.com",
        request_path="/platform/v1/wallets",
    ))

    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(
            "https://api.cdp.coinbase.com/platform/v1/wallets?pageSize=100",
            headers={"Authorization": f"Bearer {token}"},
        )
        if resp.status_code == 429:
            print("  Rate limited — wait a couple minutes and try again.")
            return
        if resp.status_code != 200:
            print(f"  HTTP {resp.status_code}: {resp.text[:500]}")
            return

        data = resp.json()
        wallets = data.get("data", [])
        print(f"Found {len(wallets)} wallets:")
        for w in wallets:
            wid = w.get("id", "?")
            network = w.get("network_id", "?")
            addr = w.get("default_address", {})
            address = addr.get("address_id", "?") if isinstance(addr, dict) else "?"
            print(f"  {address} | network={network} | wallet_id={wid}")

        if data.get("has_more"):
            print("  ... more pages available")


async def main():
    print("=== New EVM Accounts (v2 API) ===")
    await list_new_evm_accounts()

    print("\n=== Old Wallets (v1 API — portal-created) ===")
    await list_v1_wallets()


asyncio.run(main())
