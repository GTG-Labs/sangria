import asyncio
import json

import httpx
from eth_account import Account
from x402 import x402Client
from x402.mechanisms.evm.exact import register_exact_evm_client
from x402.http.clients.httpx import x402HttpxClient

from wallet import TestnetWallet, get_cdp_client

MERCHANT_ADDRESS = "0xF44cc4b82470Eb3D1fDAc83b8b7226d7cD07fd39"
BUYER_ADDRESS = "0x0b7b1E88e321C3f326776e35C042bb3d035Be649"
TINYFISH_API_URL = "http://127.0.0.1:8000"


async def setup_x402_client(buyer_address: str) -> x402HttpxClient:
    client = get_cdp_client()
    private_key_hex = await client.evm.export_account(address=buyer_address)
    account = Account.from_key(bytes.fromhex(private_key_hex))

    x402_client = x402Client()
    register_exact_evm_client(x402_client, account)

    return x402HttpxClient(x402_client, timeout=httpx.Timeout(660.0))


async def main():
    merchant = TestnetWallet.from_existing(MERCHANT_ADDRESS)
    buyer = TestnetWallet.from_existing(BUYER_ADDRESS)


    m_usdc = await merchant.get_usdc_balance()
    b_usdc = await buyer.get_usdc_balance()
    print(f"\n--- Initial Balances ---")
    print(f"  TinyFish ({merchant.address}): {m_usdc:.6f} USDC")
    print(f"  Buyer    ({buyer.address}): {b_usdc:.6f} USDC\n")

    http_client = await setup_x402_client(BUYER_ADDRESS)

    async with http_client:

        automation_body = {
            "url": "https://news.ycombinator.com",
            "goal": "Get the top 3 posts",
        }

        response = await http_client.post(f"{TINYFISH_API_URL}/run", json=automation_body)

        print(f"/run — Status: {response.status_code}")
        print(json.dumps(response.json(), indent=2))



        
        if response.status_code == 200:
            data = response.json()
            steps = data.get("num_of_steps", 0)
            cost = data.get("payment", {}).get("cost_usd", 0)
            print(f"price = {steps} * $0.015 = ${cost}")




















    print("\nWaiting for settlement...")
    await asyncio.sleep(3)

    m_usdc = await merchant.get_usdc_balance()
    b_usdc = await buyer.get_usdc_balance()
    print(f"\n--- Final Balances ---")
    print(f"  TinyFish ({merchant.address}): {m_usdc:.6f} USDC")
    print(f"  Buyer    ({buyer.address}): {b_usdc:.6f} USDC\n")

    await get_cdp_client().close()


if __name__ == "__main__":
    asyncio.run(main())
