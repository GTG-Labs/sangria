import uvicorn

from merchant_server.app import app

if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8000)
