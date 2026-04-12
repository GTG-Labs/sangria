# Sangria Overview

## What Sangria is

Sangria is a **digital financial bridge** that connects **fiat-funded digital wallets** to the **x402 HTTP-native payment protocol**, enabling programmatic micropayments using **pre-funded credits**.

## Account types

Each user can have one of two account types on Sangria, with different capabilities.

1. **Client account**: can purchase **Sangria Credits** and use them to pay for requests on the platform. Client accounts cannot withdraw funds from a Sangria wallet to a personal bank account.
2. **Merchant account**: can withdraw money from a Sangria wallet to a personal bank account. Merchant accounts do not purchase credits.

## End-to-end operational flow

The client is a raw x402 wallet paying in USDC. The merchant is on Sangria and receives a fiat-denominated balance.

**Flow**

1. External client follows normal x402 flow, signs the **ERC-3009 TransferWithAuthorization** with its own wallet, and pays USDC to **Sangria's Hot Wallet** (assigned to the merchant).
2. Hot wallet receives USDC on-chain.
3. Sangria converts USDC → fiat via off-ramp.
4. Sangria credits merchant's Sangria account balance (minus platform fee).
5. Merchant releases data once settlement confirms.

## Protocols & standards

| Protocol / standard | Role                                                                                |
| ------------------- | ----------------------------------------------------------------------------------- |
| **x402**            | HTTP-native payment protocol using `402 Payment Required`                           |
| **ERC-3009**        | USDC gasless `TransferWithAuthorization` (third party submits pre-signed transfers) |
| **EIP-712**         | Typed structured data signing format used for ERC-3009 authorizations               |
