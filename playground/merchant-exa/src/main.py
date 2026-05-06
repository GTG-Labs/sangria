import asyncio
import os

from dotenv import load_dotenv
load_dotenv()

from exa_py import Exa
from fastapi import FastAPI, Request
from sangria_sdk import SangriaMerchantClient
from sangria_sdk.adapters.fastapi import require_sangria_payment

app = FastAPI(title="Merchant Exa")

sangria_key = os.getenv("SANGRIA_SECRET_KEY")
if not sangria_key:
    raise RuntimeError("SANGRIA_SECRET_KEY environment variable is required")

client = SangriaMerchantClient(
    base_url=os.getenv("SANGRIA_URL", "http://localhost:8080"),
    api_key=sangria_key,
)

exa_key = os.getenv("EXA_API_KEY")
if not exa_key:
    raise RuntimeError("EXA_API_KEY environment variable is required")

exa = Exa(api_key=exa_key)


@app.get("/")
async def health():
    return {"message": "Hello! This endpoint is free."}


@app.get("/search")
@require_sangria_payment(client, amount=0.01, description="Exa web search")
async def search(request: Request, q: str):
    # exa-py is synchronous; offload to a worker thread so we don't block the
    # FastAPI event loop while Exa is fetching results.
    response = await asyncio.to_thread(exa.search, q, num_results=5)
    return {
        "query": q,
        "results": [
            {
                "title": r.title,
                "url": r.url,
                "published_date": r.published_date,
                "author": r.author,
                "score": r.score,
            }
            for r in response.results
        ],
    }


if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("PORT", "4005"))
    uvicorn.run(app, host="0.0.0.0", port=port)
