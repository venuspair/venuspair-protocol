# Venus Pair

One gas giant. Ten loud tickers.

[![Live site](https://img.shields.io/badge/live-venuspair.xyz-black?style=flat-square)](https://venuspair.xyz)
![Chain](https://img.shields.io/badge/chain-Solana-black?style=flat-square)

**Chain:** Solana
**Contract address:** `pending`

## Overview

Venus Pair is a Solana token with a live board attached. The page pulls the boosted Solana tokens from DexScreener, ranks the ten with the heaviest 24h volume, and refreshes them every minute while the tab is visible.

## Features

- Live board of the ten heaviest boosted Solana tokens: logo, price, 24h change, volume, liquidity, copy-address button
- Scrolling ticker and stat tiles driven by the same data
- Contract slot pinned to the top of the page, click to copy once an address is stated
- Backoff on failures, last good data kept, polling paused while the tab is hidden
- Motion throughout, with an instant fallback under `prefers-reduced-motion`
- Static output: drag `dist/` onto Cloudflare Pages

## Links

- Site: https://venuspair.xyz
- X: pending
- GitHub: pending

## Development

```bash
npm install
npm run build   # writes dist/
npm run gates   # build checks, both register branches
npm run serve   # preview dist/ on http://localhost:4173
```

Every external fact (contract, socials, market source, chain) lives as one record in `src/register.json` with a state of `stated`, `absent` or `unconfirmed`. Unstated records render inert: no value, no link.

## License

MIT
