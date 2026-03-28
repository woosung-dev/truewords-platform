from fastapi import FastAPI
from api.routes import router

app = FastAPI(title="TrueWords RAG PoC", version="0.1.0")
app.include_router(router)


@app.get("/health")
def health():
    return {"status": "ok"}
