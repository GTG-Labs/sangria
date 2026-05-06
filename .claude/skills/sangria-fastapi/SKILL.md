---
name: sangria-fastapi
description: Wrap a single FastAPI endpoint with the Sangria SDK so it accepts x402 payments. Use when the user asks to add Sangria payment to a route, paywall a FastAPI endpoint, "wrap" a route with x402, or make a FastAPI route paid.
argument-hint: <file_path>
arguments: file_path
---

# sangria-fastapi

Adds Sangria SDK wrapping to a single FastAPI endpoint. Inserts the SDK imports, the merchant client initialization (with fail-loud env-var checks), and the `@require_sangria_payment(...)` decorator on the target route.

**FastAPI only.** For Express / Fastify / Hono / Next.js, edit by hand using `playground/merchant-exa/src/main.py` as a reference.

## Required prompts

Before making any edits, you MUST collect the following from the user. If any are missing from the original request, ask for them — one at a time, briefly:

1. **File path** to the FastAPI app file (e.g., `playground/merchant-exa-bare/src/main.py`). Required argument.
2. **Endpoint** to wrap. Auto-pick if the file has only one route handler. If multiple, ask which one — accept either the route path (`/search`) or the handler function name (`search`).
3. **Amount** in USDC, e.g., `0.01` for one cent. ASK every time, even if it seems obvious. Quote the response back to the user before editing.
4. **Description** — short human-readable string that appears in the 402 response (`description=` arg on the decorator). ASK every time.

## What to do

1. **Read** the file specified by the user.
2. **Sanity-check** it's a FastAPI app:
   - Imports from `fastapi` (`from fastapi import FastAPI`).
   - Has an `app = FastAPI(...)` (or similar) line.
   If neither is present, abort with: "This skill only handles FastAPI apps. The file at `<path>` doesn't appear to be one."
3. **Identify the target endpoint**:
   - Match the user's identifier against `@app.get(...)`, `@app.post(...)`, `@app.put(...)`, `@app.delete(...)`, `@app.patch(...)` decorators.
   - Path match: `@app.get("/search")` matches `/search`.
   - Function-name match: the handler `async def search(...)` (or sync `def search(...)`) matches `search`.
4. **Idempotency check**:
   - If the target endpoint already has `@require_sangria_payment(...)` above the handler, abort with: "`<endpoint>` is already wrapped with Sangria."
5. **Apply edits in this order**:

   **a. Imports** — insert after the last existing top-level import. Skip this step if the file already has `from sangria_sdk import SangriaMerchantClient`.
   ```python
   from sangria_sdk import SangriaMerchantClient
   from sangria_sdk.adapters.fastapi import require_sangria_payment
   ```

   **b. Client init** — insert immediately after the `app = FastAPI(...)` line. Skip this step if a `client = SangriaMerchantClient(...)` block already exists in the file. If the file doesn't already import `os`, also add `import os` at the top.
   ```python
   sangria_key = os.getenv("SANGRIA_SECRET_KEY")
   if not sangria_key:
       raise RuntimeError("SANGRIA_SECRET_KEY environment variable is required")

   client = SangriaMerchantClient(
       base_url=os.getenv("SANGRIA_URL", "http://localhost:8080"),
       api_key=sangria_key,
   )
   ```

   **c. Decorator** — insert directly between the `@app.{method}(...)` decorator line and the handler's `async def` / `def` line. Use the `amount` and `description` collected earlier:
   ```python
   @require_sangria_payment(client, amount={AMOUNT}, description="{DESCRIPTION}")
   ```
   Match the indentation of the existing `@app.{method}(...)` decorator.

6. **Re-read the file** after editing and confirm the structure looks right (imports present, client present, decorator on the target endpoint, no duplicate blocks).

## Reporting

After successful edits, report concisely:

```
Wrapped <route_path> in <file_path> with Sangria.
  - Amount: $<amount> USDC
  - Description: "<description>"
  - Imports added: <yes/skipped>
  - Client init added: <yes/skipped>
  - Decorator added: yes
```

Then check the project's `pyproject.toml` for the `sangria-core` dependency:
- If present: report "`sangria-core` already in pyproject.toml."
- If missing: tell the user explicitly:
  > `sangria-core` is NOT in pyproject.toml. Add it before running:
  > ```toml
  > [project]
  > dependencies = [..., "sangria-core"]
  >
  > [tool.uv.sources]
  > sangria-core = { path = "../../sdk/python", editable = true }
  > ```
  > Then run `uv sync`.

Do not modify pyproject.toml automatically — leave that to the user.

## Hard rules

- Do NOT modify any file other than the one the user specifies.
- Do NOT skip the amount and description prompts even if the user mentions them in passing — confirm them back before editing.
- Do NOT add `sangria-core` to pyproject.toml automatically.
- Do NOT run the server, install packages, or hit any endpoint as part of this skill.
- Do NOT touch other endpoints in the file — only the one the user specified.

## Example flow

```
User: Use sangria-fastapi to wrap /search in playground/merchant-exa-bare/src/main.py
You: What price (USDC) should /search charge?
User: 0.01
You: What description should appear in the 402 response for /search?
User: Exa web search
You: [makes the three edits]
You: Wrapped /search in playground/merchant-exa-bare/src/main.py with Sangria.
       - Amount: $0.01 USDC
       - Description: "Exa web search"
       - Imports added: yes
       - Client init added: yes
       - Decorator added: yes
     `sangria-core` already in pyproject.toml.
```
