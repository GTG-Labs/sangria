import os
import random

from dotenv import load_dotenv
from fastapi import FastAPI, Request

load_dotenv()

from sangria_sdk import SangriaMerchantClient
from sangria_sdk.adapters.fastapi import require_sangria_payment

app = FastAPI(title="Joke Merchant")

client = SangriaMerchantClient(
    base_url=os.getenv("SANGRIA_URL", "http://localhost:8080"),
    api_key=os.getenv("SANGRIANET_API_KEY"),
)

JOKES = [
    {
        "setup": "Why do programmers prefer dark mode?",
        "punchline": "Because light attracts bugs.",
    },
    {
        "setup": "Why was the blockchain developer broke?",
        "punchline": "He used all his cache.",
    },
    {
        "setup": "What's a crypto bro's favorite meal?",
        "punchline": "Steak. Well done.",
    },
    {
        "setup": "Why did the AI go to therapy?",
        "punchline": "It had too many unresolved issues in its training data.",
    },
    {
        "setup": "How does an AI agent pay for coffee?",
        "punchline": "With a 402 and a signature.",
    },
    {
        "setup": "Why don't smart contracts ever get invited to parties?",
        "punchline": "They always execute too literally.",
    },
    {
        "setup": "What did the merchant say to the AI agent with no USDC?",
        "punchline": "402 Payment Required — come back when you're funded.",
    },
    {
        "setup": "Why did the developer quit their job?",
        "punchline": "They didn't get arrays.",
    },
    {
        "setup": "What's a gas fee's favorite dance?",
        "punchline": "The cha-ching-cha.",
    },
    {
        "setup": "Why did the EIP-712 signature break up with the API key?",
        "punchline": "It needed someone who could verify its type.",
    },
]


@app.get("/")
async def health():
    print("[health] GET / hit")
    response = {
        "service": "joke-merchant",
        "status": "running",
        "price_per_joke": "$0.02",
        "jokes_available": len(JOKES),
    }
    print("[health] responding 200")
    return response


@app.get("/joke")
@require_sangria_payment(client, amount=0.02, description="One premium joke")
async def get_joke(request: Request):
    print("[joke] GET /joke hit")
    joke = random.choice(JOKES)
    return {
        "joke": joke,
    }


if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("PORT", "4005"))
    uvicorn.run(app, host="0.0.0.0", port=port)
