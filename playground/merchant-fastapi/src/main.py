import os

from fastapi import FastAPI, Request

from sangria_sdk import SangriaMerchantClient
from sangria_sdk.adapters.fastapi import require_sangria_payment

app = FastAPI(title="Merchant FastAPI")

client = SangriaMerchantClient(
    base_url=os.getenv("SANGRIA_URL", "http://localhost:8080"),
    api_key=os.getenv("SANGRIA_SECRET_KEY", "sk_test_abc123"),
)


@app.get("/")
async def health():
    return {"message": "Hello! This endpoint is free."}


@app.get("/premium")
@require_sangria_payment(client, amount=10000, description="Access premium content")  # 10000 microunits = $0.01
async def premium(request: Request):
    return {"message": "You accessed the premium endpoint!"}


if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("PORT", "4004"))
    uvicorn.run(app, host="0.0.0.0", port=port)
