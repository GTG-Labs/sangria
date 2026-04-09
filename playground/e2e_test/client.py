"""
Test client that pays for resources using the x402 SDK.

Usage:
  cd playground
  MERCHANT_URL=http://localhost:4004 uv run python -m e2e_test.client --buyer-address 0x...
"""

import argparse
import asyncio
import base64
import json

import httpx
from eth_account import Account
from x402 import x402Client
from x402.schemas import PaymentRequired, PaymentRequirements
from x402.mechanisms.evm.exact import register_exact_evm_client

import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from wallet import get_cdp_client

MERCHANT_URL = os.getenv("MERCHANT_URL", "http://localhost:4004")

async def main(buyer_address: str):
    print(f"Setting up x402 client for buyer: {buyer_address}")
    cdp_client = get_cdp_client()
    private_key_hex = await cdp_client.evm.export_account(address=buyer_address)
    account = Account.from_key(bytes.fromhex(private_key_hex))

    x402_client = x402Client()
    register_exact_evm_client(x402_client, account)

    # Step 1: Hit the merchant endpoint — expect a 402
    print(f"\n=== Step 1: GET {MERCHANT_URL}/premium ===")
    async with httpx.AsyncClient(timeout=httpx.Timeout(30.0)) as client:
        resp = await client.get(f"{MERCHANT_URL}/premium")

    print(f"Status: {resp.status_code}")
    print(f"Headers: {dict(resp.headers)}")
    print(f"Body: {json.dumps(resp.json(), indent=2)}")

    if resp.status_code != 402:
        print(f"\nExpected 402, got {resp.status_code}. Stopping.")
        await cdp_client.close()
        return

    # Step 2: Parse the 402 response and sign the payment
    print(f"\n=== Step 2: Sign Payment ===")
    payment_data = resp.json()
    accepts = payment_data["accepts"][0]

    print(f"Scheme: {accepts['scheme']}")
    print(f"Network: {accepts['network']}")
    print(f"Amount: {accepts.get('amount', accepts.get('maxAmountRequired', 'N/A'))}")
    print(f"Asset: {accepts['asset']}")
    print(f"PayTo: {accepts['payTo']}")

    payment_required = PaymentRequired(
        x402_version=payment_data.get("x402Version", 2),
        accepts=[
            PaymentRequirements(
                scheme=accepts["scheme"],
                network=accepts["network"],
                amount=accepts.get("amount", accepts.get("maxAmountRequired")),
                asset=accepts["asset"],
                pay_to=accepts["payTo"],
                max_timeout_seconds=accepts["maxTimeoutSeconds"],
                extra=accepts.get("extra", {}),
            )
        ],
    )

    payment_payload = await x402_client.create_payment_payload(payment_required)
    print(f"Payment signed by: {buyer_address}")

    # Log the payload structure
    payload_dict = payment_payload.model_dump()
    print(f"Payload x402Version: {payload_dict.get('x402_version')}")
    print(f"Payload scheme: {payload_dict.get('accepted', {}).get('scheme')}")
    print(f"Payload keys: {list(payload_dict.get('payload', {}).keys())}")

    # Step 3: Encode and send the signed payment back
    print(f"\n=== Step 3: Retry with payment ===")
    payload_json = payment_payload.model_dump_json()
    payload_b64 = base64.b64encode(payload_json.encode()).decode()
    print(f"Payload base64 length: {len(payload_b64)}")
    print(f"Payload JSON (first 200 chars): {payload_json[:200]}...")

    async with httpx.AsyncClient(timeout=httpx.Timeout(120.0)) as client:
        resp = await client.get(
            f"{MERCHANT_URL}/premium",
            headers={"PAYMENT-SIGNATURE": payload_b64},
        )

    print(f"\nFinal status: {resp.status_code}")
    print(json.dumps(resp.json(), indent=2))

    if resp.status_code == 200:
        data = resp.json()
        print(f"\n=== Payment successful! ===")
        if "settlement" in data:
            print(f"TX: {data['settlement'].get('transaction')}")
            print(f"Payer: {data['settlement'].get('payer')}")

    await cdp_client.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="x402 test client")
    parser.add_argument("--buyer-address", required=True, help="Buyer wallet address (0x...)")
    args = parser.parse_args()
    asyncio.run(main(args.buyer_address))
