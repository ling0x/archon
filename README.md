# Archon

<p align="center">
  <img src="static/logo.png" alt="Archon" width="72" />
</p>

A minimalistic AI-powered search assistant that combines **SearXNG** (local web
search) with **Ollama** (local LLM) to answer your questions using real web
results.

## Prerequisites

- [Node.js](https://nodejs.org) ≥ 18
- SearXNG running on `http://localhost:8080`
- Ollama running on `http://localhost:11434` with model `gpt-oss:20b` pulled

## Setup

cd into searxng folder and then setup the .env file based on .env.example and
then run `docker compose up -d`.

download ollama and pull your favorite model and then `ollama serve`.

```bash
npm install
npm run dev
```

Then open [http://localhost:5173](http://localhost:5173).

## How it works

1. You type a question in the input box and hit **Search**.
2. The app queries your local SearXNG instance and retrieves the top 8 results.
3. The results are bundled into a prompt and sent to Ollama (`gpt-oss:20b`) via
   streaming.
4. The answer streams in token-by-token, with sources listed below.

## Architecture

```
browser  →  Vite dev-server proxy  →  SearXNG  :8080
                                  →  Ollama   :11434
```

Vite's proxy avoids CORS issues — all requests go through `/searxng/*` and
`/ollama/*`.

## Build for production

```bash
npm run build   # outputs to dist/
npm run preview
```

For production you'll need a reverse proxy (nginx / Caddy) to forward `/searxng`
and `/ollama` paths.
