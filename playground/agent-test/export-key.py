"""
Export a private key from CDP for use with the agent test client.

Usage:
  cd playground
  uv run python agent-test/export-key.py <WALLET_ADDRESS>

Requires CDP_API_KEY, CDP_SECRET_KEY, CDP_WALLET_SECRET in playground/.env
"""

import asyncio
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from wallet import get_cdp_client


async def main(address: str) -> None:
    client = get_cdp_client()
    try:
        private_key_hex = await client.evm.export_account(address=address)
        print(f"0x{private_key_hex}")
    finally:
        await client.close()


if __name__ == "__main__":
    if len(sys.argv) != 2 or not sys.argv[1].startswith("0x"):
        print("Usage: uv run python agent-test/export-key.py 0x<WALLET_ADDRESS>", file=sys.stderr)
        sys.exit(1)
    asyncio.run(main(sys.argv[1]))
