# Terminal of Slop

A pump.fun launchpad where every coin gets a mind: a model of the launcher's choice working at a real Linux terminal. A share of each coin's creator fees pays for that compute.

The site holds no made-up data. Everything it shows comes from a live source:

| What you see | Where it comes from |
| --- | --- |
| Coins in Explore | Solana: every pump.fun fee-sharing config that names your `COMPUTE_WALLET` as a shareholder |
| Name, ticker, image, mission, model | The coin's on-chain Token-2022 metadata and its IPFS metadata file |
| Market cap, curve progress, graduation | The coin's pump.fun bonding curve account |
| Fees waiting to split | The coin's creator vault balance |
| 24h change, graduated market cap | DexScreener |
| SOL price | CoinGecko (DexScreener as fallback) |
| Models and prices | OpenRouter's public model list |
| Live terminals, awake/asleep, compute | Your agent backend (optional, see "Agent API") |

Until a source has data, the site shows an honest empty state ("no minds yet", "terminal offline") instead of filler.

## Files

```
index.html          the page (built from src/)
config.js           your settings: fill this in
assets/app.js       site logic
assets/tos-chain.js Solana + pump.fun module (bundled from src/chain.js)
api/upload.js       serverless function: pins image + metadata to IPFS
src/                sources for index.html and tos-chain.js
```

## Go live (about 20 minutes)

1. **Make a compute wallet.** Create a fresh Solana wallet that only receives compute fees. Put its address in `config.js` as `COMPUTE_WALLET`. Launches stay switched off until this is set.
2. **Get an RPC URL.** Sign up at Helius, Triton or QuickNode (a free tier is enough to start). The URL must allow `getProgramAccounts`. Put it in `config.js` as `RPC_URL`. The URL is visible to visitors, so lock it to your domain in the provider's dashboard.
3. **Get a Pinata key.** At pinata.cloud create an API key (JWT) with file upload permission.
4. **Deploy to Vercel.** Push this folder to a GitHub repo and import it in Vercel. You don't need a build step. In Project → Settings → Environment Variables add:
   - `PINATA_JWT` = your Pinata JWT
   - `SITE_URL` = your domain, for example `https://terminalofslop.com`
5. **Point your domain** at the Vercel project and set `SITE_URL` and `X_URL` in `config.js`.
6. **Do a test launch** with a small dev buy (or none). Check that the coin shows up on pump.fun, that the second transaction set the fee split, and that the coin appears in Explore within a minute.

Other hosts work too. The page is static, and only `api/upload.js` needs a Node 18+ function runtime (Netlify or Cloudflare need a small wrapper).

## How a launch works

The launcher's own wallet signs two transactions:

1. **Create**: pump.fun `create_v2` plus the optional dev buy. The launcher is the creator and holds the dev-buy tokens.
2. **Fee split**: `create_fee_sharing_config` + `update_fee_shares` on pump.fun's fee program. The split pays `COMPUTE_WALLET` the share the launcher picked (from `COMPUTE_SHARE_OPTIONS`) and the launcher the rest.

If the second transaction fails, the coin still exists but keeps 100% of its fees with the launcher and doesn't appear on the site. The page remembers this and offers a "Retry fee split" button.

Creator fees build up in the coin's creator vault ("fees waiting to split" on each card). They reach the shareholders only when someone calls pump.fun's permissionless `distribute_creator_fees`. Your agent backend should do this on a schedule. In `@pump-fun/pump-sdk` it's `OnlinePumpSdk.buildDistributeCreatorFeesInstructions(mint)`.

Launch transactions stay under Solana's 1,232-byte limit for any valid name. The priority fee is dropped only when a long name and ticker leave no room for it.

## Agent API (optional)

Set `AGENT_API` in `config.js` once your backend exists. The site calls three endpoints and needs CORS enabled for your domain:

- `GET /minds` returns `[{ "mint": "...", "awake": true, "computeSol": 0.84, "commands": 4210, "shipped": 12 }]`
- `GET /feed` returns recent compute top-ups: `[{ "mint": "...", "amountSol": 0.0123, "at": "2026-10-02T18:20:00Z" }]`
- `GET /minds/:mint/stream` is Server-Sent Events. Each message is `{ "k": "c" | "o" | "k" | "w", "t": "text" }`, where `c` is a typed command, `o` output, `k` success, `w` warning.

Each coin's model id (an OpenRouter id) and mission are in its IPFS metadata under `terminalOfSlop`, so the backend can read them from the chain the same way the site does.

## Editing

- Text, layout and styles live in `src/body.html`, `src/base.css` and `src/extra.css`. Run `python3 src/build.py` to rebuild `index.html`.
- Site behavior lives in `assets/app.js` and needs no build.
- To change the chain module, edit `src/chain.js`, then run:
  ```
  npm install
  npm run build:chain
  ```

## Before you promote it

- Launching creates real tokens and spends real SOL. Do a small test launch on mainnet first. The flow was tested against stubs and pump.fun's own SDK encoders, not on mainnet.
- Rate-limit `/api/upload` properly (Vercel Firewall or Upstash). The built-in limit only covers a single server instance.
- Check the rules for running a token launchpad where you operate.
