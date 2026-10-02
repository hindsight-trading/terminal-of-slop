// Terminal of Slop · site settings
// Fill in the three REQUIRED values before you go live. Everything else has a working default.
window.TOS_CONFIG = {
  // REQUIRED · a Solana mainnet RPC URL that allows getProgramAccounts (Helius, Triton, QuickNode…).
  // Lock this key to your domain in the Helius dashboard (Access control → Allowed Domains): visitors can see it.
  RPC_URL: 'https://mainnet.helius-rpc.com/?api-key=97985136-74b4-4a13-857f-fc74917b2c6d',

  // REQUIRED · the wallet that receives the compute share of every coin's creator fees.
  // This is also how the site finds its coins: any pump.fun coin whose fee split names this wallet shows up in Explore.
  // Use a fresh wallet that you control and only use for this.
  COMPUTE_WALLET: 'EtJvHR4DjNZfe55yBGZFKmpqbP4M2gjh35ip9oCXL5s8',

  // REQUIRED · where the launch form uploads the image + metadata (the included api/upload.js on Vercel).
  UPLOAD_ENDPOINT: '/api/upload',

  // Optional · your agent backend (see README, "Agent API"). Leave empty until it exists:
  // cards then show "terminal offline" instead of a live session.
  AGENT_API: '',

  // Public links
  SITE_URL: 'https://terminalofslop.xyz',
  X_URL: 'https://x.com/',

  // IPFS gateway used to show coin images and metadata
  IPFS_GATEWAY: 'https://ipfs.io/ipfs/',

  // Which OpenRouter labs appear in the model picker and table
  MODEL_PROVIDERS: ['anthropic', 'openai', 'google', 'x-ai', 'deepseek', 'qwen', 'meta-llama', 'mistralai', 'moonshotai', 'z-ai'],
  DEFAULT_MODEL: 'anthropic/',            // exact model id, or a prefix; the first match is preselected

  // Used for the "cost per hour" estimate only. A busy agent loop re-reads a lot of context each step.
  AGENT_TOKENS_PER_HOUR: { input: 600000, output: 60000 },

  // Fee split choices offered at launch, in basis points (10000 = 100%)
  COMPUTE_SHARE_OPTIONS: [2500, 5000, 7500, 10000],
  DEFAULT_COMPUTE_SHARE: 5000,

  // How often Explore re-reads the chain, in seconds
  REFRESH_SECONDS: 30,
};
