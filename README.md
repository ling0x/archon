<p align="center">
  <img src="static/logo_text.png" alt="Archon" width="300" />
</p>

# Archon

A minimalistic AI-powered search assistant that combines **SearXNG** (local web
search) with **Ollama** (local LLM) to answer your questions using real web
results.

## Prerequisites

- [Node.js](https://nodejs.org) ≥ 18
- SearXNG running on `http://localhost:8080`
  - If searXNG cannot be reached, try add the following to nftables in
    archlinux:
    ```
    chain forward {
        type filter hook forward priority filter; policy drop;
        ip saddr 172.18.0.0/16 accept
        ip daddr 172.18.0.0/16 ct state established,related accept
    }
    ```
    If you are using a VPN (e.g. MullVad VPN or using MullVad Browser), you need
    to set the priority higher such as -1
    ```
    chain forward {
       type filter hook forward priority -1; policy drop;
       ip saddr 172.18.0.0/16 accept
       ip daddr 172.18.0.0/16 ct state established,related accept
     }
    ```
    Sometimes your firewall is blocking docker network access, so check ufw if
    applicable.
- Ollama running on `http://localhost:11434` with model `mistral:7b` pulled

## Setup

cd into searxng folder and then setup the .env file based on .env.example and
then run `docker compose up -d`.

download ollama and pull your favorite model and `ollama serve` if ollama isn't
already running as a service in your system, in which case you can check
`sudo systemctl status ollama`.

- For a 16GB laptop with something like RTX 2060 for GPU, you can totally run
  `mistral:7b`, its very lightweight and efficient, anything above 7b will
  struggle on a 16GB laptop; if you have 96GB RAM with RTX 4090 GPU, you can run
  `gpt-oss:20b`, `qwen3.5:35b` or `deepseek-r1:32b`; consider running quantized
  versions in resource constrained environments. Also, llama3.2:1b can also run
  on CPU instead of GPU if you are running on a server without a GPU, it can be
  done.

```bash
npm install
npm run dev
```

Then open [http://localhost:5173](http://localhost:5173).

## How it works

1. You type a question in the input box and hit **Search**.
2. The app queries your local SearXNG instance with search queries formulated by
   a lightweight AI model and then retrieves and merges the top 8 results per
   each queries (max 3 queries).
3. The results are bundled into a prompt and sent to Ollama (`mistral:7b`) via
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
