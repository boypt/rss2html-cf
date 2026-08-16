# rss2html-cf

A Cloudflare Worker that converts RSS/Atom feeds into a simple HTML page. Zero dependencies — fetch, parse and render in one go, controlled entirely by URL parameters.

> **English** | [中文](README.zh.md)

## Features

- Supports **RSS 2.0 / RSS 1.0 / Atom**
- `url` parameter points to the feed, `limit` parameter controls how many entries are shown
- Handles CDATA, entity decoding, and relative link resolution automatically
- XSS-safe output (escaped titles, `<script>` stripped from descriptions)
- Zero dependencies, deploy with `wrangler` only

## One-click deploy

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/boypt/rss2html-cf)

Click the button, authorize your GitHub repo, and Cloudflare deploys the worker for you.

## Deploy from the web editor (no Git repo needed)

This project has zero dependencies — just paste the code into Cloudflare's web editor:

1. Sign in to the [Cloudflare Dashboard](https://dash.cloudflare.com/) → **Workers & Pages** → **Create** → **Worker** → **Deploy**
2. Open your new Worker → **Edit code** (Code Editor)
3. Clear the default code and paste the full contents of [`src/index.js`](src/index.js)
4. Click **Deploy** — your worker is live at `https://your-worker-name.your-subdomain.workers.dev`

## Manual deploy (CLI)

```bash
npm install          # install wrangler
npm run deploy       # deploy to Cloudflare (needs npx wrangler login first time)
```

## Local development

```bash
npm install
npm run dev          # default http://localhost:8787
```

## Usage

```
GET /?url=https://example.com/feed.xml&limit=10
```

| Param | Required | Description |
|-------|----------|-------------|
| `url` | yes | feed address (http/https) |
| `limit` | no | number of entries to show, default 10, max 100 |

Examples:

- `https://your-worker-url/?url=https://hnrss.org/frontpage&limit=5`
- `https://your-worker-url/?url=https://feeds.bbci.co.uk/news/rss.xml`

## Project structure

```
├── src/index.js      # all worker logic: fetch, parse, render
├── wrangler.toml     # Cloudflare Worker configuration
└── package.json      # dev / deploy scripts
```

## Error responses

| Status | Scenario |
|--------|----------|
| 400 | missing or invalid `url` param |
| 404 | feed has no entries / path not found |
| 502 | fetch failure, network error, or parse failure |

## License

[MIT](LICENSE)
