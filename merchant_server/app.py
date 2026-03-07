from fastapi import FastAPI
from fastapi_x402 import init_x402, pay

MERCHANT_ADDRESS = "0xF44cc4b82470Eb3D1fDAc83b8b7226d7cD07fd39"

app = FastAPI(title="x402 Payment Demo")

init_x402(app, pay_to=MERCHANT_ADDRESS, network="base-sepolia")


@app.get("/")
def health():
    return {"status": "ok"}


@pay("$0.0001")
@app.get("/premium")
def premium():
    return {"message": "You accessed the premium endpoint!", "paid": True}
