from __future__ import annotations

import os
from cdp import CdpClient
from dotenv import load_dotenv

load_dotenv()

_client: CdpClient | None = None

def get_cdp_client() -> CdpClient:
    # Singleton — we only ever create one CDP client.
    # CDP needs 3 secrets:
    #   CDP_API_KEY      - identifies your Coinbase Developer Platform account
    #   CDP_SECRET_KEY   - proves it's really you (like a password for the API)
    #   CDP_WALLET_SECRET - encryption key for wallet private keys. CDP stores
    #                       your wallet keys on their servers, encrypted with this.
    #                       Even Coinbase can't read your keys without it.
    global _client
    if _client is None:
        _client = CdpClient(
            api_key_id=os.environ["CDP_API_KEY"],
            api_key_secret=os.environ["CDP_SECRET_KEY"],
            wallet_secret=os.environ["CDP_WALLET_SECRET"],
        )
    return _client


class TestnetWallet:
    # A testnet wallet on Base Sepolia. All funds here are FAKE — for development only.
    #
    # How crypto wallets actually work:
    #   - Every wallet is a keypair: a private key + a public address
    #   - The address is derived from the private key (one-way math)
    #   - Whoever holds the private key controls the wallet
    #
    # Why we only store the address here (no private key):
    #   CDP manages the private keys for us on their servers, encrypted with
    #   our CDP_WALLET_SECRET. When we want to send a transaction, we just
    #   call the SDK with the address — CDP decrypts the key and signs it
    #   server-side. We never need to touch the raw key ourselves.
    #
    # What's in a wallet:
    #   - ETH  (native currency) — needed to pay "gas fees" (transaction costs)
    #   - USDC (token)           — a stablecoin pegged to $1, for actual payments
    #   - ...and potentially any other token on the chain

    # Base Sepolia is the TESTNET version of the Base chain, everything here is fake money
    TESTNET_NETWORK = "base-sepolia"

    def __init__(self, address: str):
        self.address = address

    @classmethod
    async def mint(cls) -> TestnetWallet:
        # Creates a brand new wallet on Base Sepolia (testnet).
        # This generates a fresh keypair on CDP's servers and gives us the address.
        client = get_cdp_client()
        account = await client.evm.create_account()
        print(f"Testnet wallet created! Address: {account.address}")
        return cls(address=account.address)

    @classmethod
    def from_existing(cls, address: str) -> TestnetWallet:
        # Reconnect to a wallet we already created. Works because CDP still
        # has the private key stored — we just need the address to reference it.
        return cls(address=address)

    async def fund_eth(self):
        # ETH is needed for "gas" — the fee the network charges per transaction.
        # On testnet gas costs are fake, but the mechanism is real.
        # No ETH = you can't do anything, even if you have a million USDC.
        # The faucet gives a fixed amount per request (can't choose how much).
        client = get_cdp_client()
        tx = await client.evm.request_faucet(self.address, self.TESTNET_NETWORK, "eth")
        print(f"Funded {self.address} with testnet ETH! TX: {tx}")
        return tx

    async def fund_usdc(self):
        # USDC is a stablecoin (~$1 each). This is what you'd use for actual
        # payments/transfers in the app. The faucet gives us free testnet USDC.
        # The faucet gives a fixed amount per request (can't choose how much).
        client = get_cdp_client()
        tx = await client.evm.request_faucet(self.address, self.TESTNET_NETWORK, "usdc")
        print(f"Funded {self.address} with testnet USDC! TX: {tx}")
        return tx

    async def _get_balance_for(self, symbol: str) -> float:
        # Reads balances directly from the blockchain — not from a local cache.
        #
        # How this works in crypto:
        #   Unlike a bank where a central database tracks your balance, on a blockchain
        #   your "balance" is computed from the full history of transactions. The network
        #   nodes all agree on the current state. When we call this, CDP queries a node
        #   and returns what tokens this address holds.
        #
        # The raw amounts come back in the token's smallest unit (like cents to dollars):
        #   - ETH uses 18 decimals → 1 ETH = 1_000_000_000_000_000_000 wei
        #   - USDC uses 6 decimals → 1 USDC = 1_000_000 units
        # We convert to human-readable numbers here so you don't have to think about it.
        client = get_cdp_client()
        result = await client.evm.list_token_balances(self.address, self.TESTNET_NETWORK)

        for b in result.balances:
            if b.token.symbol == symbol:
                return b.amount.amount / (10 ** b.amount.decimals)
        return 0.0

    async def get_eth_balance(self) -> float:
        # Check ETH balance — useful to verify you have enough for gas.
        return await self._get_balance_for("ETH")

    async def get_usdc_balance(self) -> float:
        # Check USDC balance — the token you'd use for payments.
        return await self._get_balance_for("USDC")

    def __repr__(self):
        return f"TestnetWallet(address={self.address})"
