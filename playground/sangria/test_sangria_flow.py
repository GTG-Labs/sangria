"""
End-to-end test for the Sangria x402 payment flow.

Prerequisites:
  - Backend running on localhost:8080
  - A merchant API key (from POST /merchants)
  - CDP credentials in .env (CDP_API_KEY, CDP_SECRET_KEY, CDP_WALLET_SECRET)
  - A buyer wallet with testnet USDC on base-sepolia

Usage:
  cd playground
  uv run python test_sangria_flow.py --merchant-key "sg_test_xxxx_yyyy"

If you don't have a buyer wallet yet, run with --create-buyer first:
  uv run python test_sangria_flow.py --create-buyer
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
from wallet import TestnetWallet, get_cdp_client

SANGRIA_URL = "http://localhost:8080"


async def create_buyer():
    """Create and fund a new buyer wallet for testing."""
    print("Creating buyer wallet...")
    buyer = await TestnetWallet.mint()
    print(f"Buyer address: {buyer.address}")

    print("Funding with ETH (for gas)...")
    await buyer.fund_eth()

    print("Funding with USDC (for payments)...")
    await buyer.fund_usdc()

    await asyncio.sleep(3)

    eth = await buyer.get_eth_balance()
    usdc = await buyer.get_usdc_balance()
    print(f"\nBuyer balances:")
    print(f"  ETH:  {eth:.6f}")
    print(f"  USDC: {usdc:.6f}")
    print(f"\nSave this address for future tests: {buyer.address}")

    await get_cdp_client().close()


async def test_flow(merchant_key: str, buyer_address: str):
    """Run the full generate-payment → sign → settle-payment flow."""

    # Step 1: Generate payment via Sangria (stateless — no payment record created)
    print("\n=== Step 1: Generate Payment ===")
    async with httpx.AsyncClient(timeout=httpx.Timeout(30.0)) as client:
        resp = await client.post(
            f"{SANGRIA_URL}/payments/generate-payment",
            headers={"X-API-Key": merchant_key, "Content-Type": "application/json"},
            json={
                "amount": 0.0001,
                "description": "Test payment",
                "resource": "/test",
            },
        )

    if resp.status_code != 200:
        print(f"Error: {resp.status_code} {resp.text}")
        return

    payment_data = resp.json()
    accepts = payment_data["accepts"][0]

    print(f"Pay to: {accepts['payTo']}")
    print(f"Amount: {accepts['amount']} microunits")
    print(f"Network: {accepts['network']}")

    # Step 2: Sign the payment with the buyer's wallet
    print("\n=== Step 2: Sign Payment ===")
    cdp_client = get_cdp_client()
    private_key_hex = await cdp_client.evm.export_account(address=buyer_address)
    account = Account.from_key(bytes.fromhex(private_key_hex))

    x402_client = x402Client()
    register_exact_evm_client(x402_client, account)

    # Build the PaymentRequired object that the x402 SDK expects (v2 format).
    payment_required = PaymentRequired(
        x402_version=2,
        accepts=[
            PaymentRequirements(
                scheme=accepts["scheme"],
                network=accepts["network"],
                amount=accepts["amount"],
                asset=accepts["asset"],
                pay_to=accepts["payTo"],
                max_timeout_seconds=accepts["maxTimeoutSeconds"],
                extra=accepts.get("extra", {}),
            )
        ],
    )

    # Create the signed payment payload
    payment_payload = await x402_client.create_payment_payload(payment_required)
    print(f"Payment signed by: {buyer_address}")

    # Serialize to JSON, then base64 encode (what settle-payment expects)
    payload_json = payment_payload.model_dump_json()
    payload_b64 = base64.b64encode(payload_json.encode()).decode()

    # Step 3: Settle payment via Sangria
    # Only needs the signed payload — no payment_id or payment_requirements needed.
    # The backend extracts the recipient address and amount from the signed payload itself.
    print("\n=== Step 3: Settle Payment ===")
    async with httpx.AsyncClient(timeout=httpx.Timeout(120.0)) as client:
        resp = await client.post(
            f"{SANGRIA_URL}/payments/settle-payment",
            headers={"X-API-Key": merchant_key, "Content-Type": "application/json"},
            json={
                "payment_payload": payload_b64,
            },
        )

    result = resp.json()
    print(f"Status: {resp.status_code}")
    print(json.dumps(result, indent=2))

    if result.get("success"):
        print(f"\n=== Payment settled! ===")
        print(f"TX: {result['transaction']}")
        print(f"Payer: {result['payer']}")

    # Step 4: Check merchant balance
    print("\n=== Step 4: Check Merchant Balance ===")
    async with httpx.AsyncClient(timeout=httpx.Timeout(10.0)) as client:
        resp = await client.get(
            f"{SANGRIA_URL}/merchant/balance",
            headers={"X-API-Key": merchant_key},
        )

    print(json.dumps(resp.json(), indent=2))

    await cdp_client.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Test Sangria x402 payment flow")
    parser.add_argument("--merchant-key", help="Merchant API key (sg_test_xxx)")
    parser.add_argument("--buyer-address", help="Buyer wallet address (0x...)")
    parser.add_argument("--create-buyer", action="store_true", help="Create a new buyer wallet")
    args = parser.parse_args()

    if args.create_buyer:
        asyncio.run(create_buyer())
    elif args.merchant_key and args.buyer_address:
        asyncio.run(test_flow(args.merchant_key, args.buyer_address))
    else:
        print("Usage:")
        print("  Create buyer:  uv run python test_sangria_flow.py --create-buyer")
        print("  Run test:      uv run python test_sangria_flow.py --merchant-key sg_test_xxx --buyer-address 0x...")
