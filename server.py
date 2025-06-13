from fastapi import FastAPI, HTTPException, Depends, Request
from fastapi.responses import HTMLResponse
from pydantic_settings import BaseSettings
import httpx
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fastapi.middleware.cors import CORSMiddleware

class Settings(BaseSettings):
    """Application settings loaded from environment variables or a .env file."""

    OPENAI_API_KEY: str

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"

settings = Settings()

app = FastAPI(title="Realtime Chat Session API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"]
)

app.mount("/static", StaticFiles(directory="static"), name="static")

templates = Jinja2Templates(directory="templates")


@app.get("/", response_class=HTMLResponse)
async def read_index(request: Request):
    """Serve index.html and pass the request (needed by Jinja2)."""
    return templates.TemplateResponse("index.html", {"request": request})


@app.get("/session", summary="Create a realtime chat session with OpenAI")
async def realtime_chat_session(cfg: Settings = Depends(lambda: settings)):
    """Proxy endpoint that creates a new realtime chat session via the OpenAI API.

    The OpenAI API key must be provided in the environment variable `OPENAI_API_KEY`.
    """

    url = "https://api.openai.com/v1/realtime/sessions"
    headers = {
        "Authorization": f"Bearer {cfg.OPENAI_API_KEY}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": "gpt-4o-realtime-preview-2025-06-03",
        "voice": "verse",
    }

    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(url, headers=headers, json=payload)

    if resp.status_code != 200:
        raise HTTPException(status_code=resp.status_code, detail=resp.text)

    return resp.json()


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("server:app", host="0.0.0.0", port=8000, reload=True)
