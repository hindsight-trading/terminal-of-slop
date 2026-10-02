// Terminal of Slop · on-chain helpers (bundled to assets/tos-chain.js)
import { Buffer } from 'buffer';
if (!globalThis.Buffer) globalThis.Buffer = Buffer;

import {
  Connection, PublicKey, Keypair, VersionedTransaction, TransactionMessage,
  ComputeBudgetProgram, LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import { TOKEN_2022_PROGRAM_ID, unpackMint, getExtensionData, ExtensionType } from '@solana/spl-token';
import { unpack as unpackTokenMetadata } from '@solana/spl-token-metadata';
import BN from 'bn.js';
import bs58 from 'bs58';
import {
  PUMP_SDK, OnlinePumpSdk, PUMP_FEE_PROGRAM_ID, bondingCurvePda, creatorVaultPda,
  feeSharingConfigPda, getBuyTokenAmountFromSolAmount, bondingCurveMarketCap, computeFeesBps,
  newBondingCurve,
} from '@pump-fun/pump-sdk';

const SHARING_CONFIG_DISC = Buffer.from([216, 74, 9, 0, 56, 140, 93, 75]);
// SharingConfig layout: disc 8 · bump 1 · version 1 · status 1 · mint 32 · admin 32 · admin_revoked 1 · vec len 4 · [address 32 · share_bps 2]...
const OFF_MINT = 11;
const OFF_SHAREHOLDERS = 80;
const SHAREHOLDER_SIZE = 34;
const VAULT_RENT = 890880; // rent-exempt minimum for a 0-byte system account

let connection = null;
let online = null;
let cachedGlobal = null;
let cachedFeeConfig = null;

export function init({ rpcUrl }) {
  connection = new Connection(rpcUrl, 'confirmed');
  online = new OnlinePumpSdk(connection);
  cachedGlobal = null; cachedFeeConfig = null;
  return true;
}
function need() { if (!connection) throw new Error('Call TOS.init({ rpcUrl }) first.'); }

async function globals() {
  need();
  if (!cachedGlobal) cachedGlobal = await online.fetchGlobal();
  if (!cachedFeeConfig) { try { cachedFeeConfig = await online.fetchFeeConfig(); } catch (e) { cachedFeeConfig = null; } }
  return { global: cachedGlobal, feeConfig: cachedFeeConfig };
}

export function decodeSharingConfigRaw(data) {
  const buf = Buffer.from(data);
  const mint = new PublicKey(buf.subarray(OFF_MINT, OFF_MINT + 32));
  const admin = new PublicKey(buf.subarray(OFF_MINT + 32, OFF_MINT + 64));
  const n = buf.readUInt32LE(OFF_SHAREHOLDERS - 4);
  const shareholders = [];
  for (let i = 0; i < n && i < 10; i++) {
    const o = OFF_SHAREHOLDERS + i * SHAREHOLDER_SIZE;
    if (o + SHAREHOLDER_SIZE > buf.length) break;
    shareholders.push({ address: new PublicKey(buf.subarray(o, o + 32)).toBase58(), shareBps: buf.readUInt16LE(o + 32) });
  }
  return { mint: mint.toBase58(), admin: admin.toBase58(), shareholders };
}

/** Every coin whose creator-fee split names `computeWallet` as one of its first two shareholders. */
export async function discoverCoins(computeWallet) {
  need();
  const wallet = new PublicKey(computeWallet);
  const seen = new Map();
  for (const slot of [0, 1]) {
    const accounts = await connection.getProgramAccounts(PUMP_FEE_PROGRAM_ID, {
      filters: [
        { memcmp: { offset: 0, bytes: bs58.encode(SHARING_CONFIG_DISC) } },
        { memcmp: { offset: OFF_SHAREHOLDERS + slot * SHAREHOLDER_SIZE, bytes: wallet.toBase58() } },
      ],
    });
    for (const a of accounts) {
      const d = decodeSharingConfigRaw(a.account.data);
      const me = d.shareholders.find(s => s.address === wallet.toBase58());
      seen.set(d.mint, { ...d, sharingConfig: a.pubkey.toBase58(), computeShareBps: me ? me.shareBps : 0 });
    }
  }
  return [...seen.values()];
}

async function multi(keys) {
  const out = [];
  for (let i = 0; i < keys.length; i += 100) {
    const r = await connection.getMultipleAccountsInfo(keys.slice(i, i + 100));
    out.push(...r);
  }
  return out;
}

/** Live state for many mints: token metadata, bonding curve, market cap, progress and pending creator fees. */
export async function readCoins(mints) {
  need();
  const { global } = await globals();
  const mintKeys = mints.map(m => new PublicKey(m));
  const curveKeys = mintKeys.map(m => bondingCurvePda(m));
  const vaultKeys = mintKeys.map(m => creatorVaultPda(feeSharingConfigPda(m)));
  const [mintInfos, curveInfos, vaultInfos] = await Promise.all([multi(mintKeys), multi(curveKeys), multi(vaultKeys)]);
  const initReal = new BN(global.initialRealTokenReserves.toString());
  return mintKeys.map((mk, i) => {
    const res = { mint: mk.toBase58() };
    try {
      const mi = mintInfos[i];
      if (mi) {
        const m = unpackMint(mk, mi, mi.owner);
        const ext = getExtensionData(ExtensionType.TokenMetadata, m.tlvData);
        if (ext) { const md = unpackTokenMetadata(ext); res.name = md.name; res.symbol = md.symbol; res.uri = md.uri; }
        res.supply = m.supply.toString();
      }
    } catch (e) { res.metaError = String(e.message || e); }
    try {
      const ci = curveInfos[i];
      if (ci) {
        const bc = PUMP_SDK.decodeBondingCurve(ci);
        res.complete = bc.complete;
        res.creator = bc.creator.toBase58();
        const mcap = bondingCurveMarketCap({ mintSupply: bc.tokenTotalSupply, virtualQuoteReserves: bc.virtualQuoteReserves, virtualTokenReserves: bc.virtualTokenReserves });
        res.mcapSol = Number(mcap.toString()) / LAMPORTS_PER_SOL;
        const left = new BN(bc.realTokenReserves.toString());
        res.progress = bc.complete ? 1 : Math.max(0, Math.min(1, 1 - Number(left.muln(10000).div(initReal).toString()) / 10000));
        res.realSol = Number(bc.realQuoteReserves.toString()) / LAMPORTS_PER_SOL;
      }
    } catch (e) { res.curveError = String(e.message || e); }
    const vi = vaultInfos[i];
    res.feesPendingSol = vi ? Math.max(0, vi.lamports - VAULT_RENT) / LAMPORTS_PER_SOL : 0;
    return res;
  });
}

/** Creator fee rate (bps) a brand-new coin pays right now, read from pump's fee config. */
export async function newCoinCreatorFeeBps() {
  const { global, feeConfig } = await globals();
  const curve = newBondingCurve(global);
  try {
    const f = computeFeesBps({ global, feeConfig, mintSupply: global.tokenTotalSupply, virtualQuoteReserves: curve.virtualQuoteReserves, virtualTokenReserves: curve.virtualTokenReserves, quoteMint: PublicKey.default });
    return Number(f.creatorFeeBps.toString());
  } catch (e) {
    return Number((global.creatorFeeBasisPoints || new BN(0)).toString());
  }
}

export async function solBalance(address) {
  need();
  return (await connection.getBalance(new PublicKey(address))) / LAMPORTS_PER_SOL;
}

/**
 * Build the two launch transactions.
 * tx 1: create the coin (Token-2022) + first buy, creator = launcher.
 * tx 2: open a creator-fee sharing config and split fees between the compute wallet and the launcher.
 * The wallet signs both first; then `finishLaunch` adds the mint signature and sends them in order.
 */
export async function prepareLaunch({ user, name, symbol, uri, devBuySol, computeWallet, computeShareBps }) {
  need();
  const userKey = new PublicKey(user);
  const compute = new PublicKey(computeWallet);
  const share = Math.round(computeShareBps);
  if (!(share > 0 && share <= 10000)) throw new Error('Compute share must be between 0.01% and 100%.');
  if (compute.equals(userKey)) throw new Error('The compute wallet cannot be the launching wallet.');
  const { global, feeConfig } = await globals();
  const mint = Keypair.generate();

  const solLamports = new BN(Math.round((devBuySol || 0) * LAMPORTS_PER_SOL));
  let createIxs;
  if (solLamports.gtn(0)) {
    const amount = getBuyTokenAmountFromSolAmount({ global, feeConfig, mintSupply: null, bondingCurve: null, amount: solLamports, quoteMint: PublicKey.default });
    createIxs = await PUMP_SDK.createV2AndBuyInstructions({ global, mint: mint.publicKey, name, symbol, uri, creator: userKey, user: userKey, amount, solAmount: solLamports, mayhemMode: false });
  } else {
    createIxs = [await PUMP_SDK.createV2Instruction({ mint: mint.publicKey, name, symbol, uri, creator: userKey, user: userKey, mayhemMode: false })];
  }

  const shareholders = share >= 10000
    ? [{ address: compute, shareBps: 10000 }]
    : [{ address: compute, shareBps: share }, { address: userKey, shareBps: 10000 - share }];
  const feeIxs = [
    await PUMP_SDK.createFeeSharingConfig({ creator: userKey, mint: mint.publicKey, pool: null }),
    await PUMP_SDK.updateFeeShares({ authority: userKey, mint: mint.publicKey, currentShareholders: [userKey], newShareholders: shareholders }),
  ];

  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
  const budget = (units, microLamports) => [
    ComputeBudgetProgram.setComputeUnitLimit({ units }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports }),
  ];
  const build = ixs => new VersionedTransaction(new TransactionMessage({ payerKey: userKey, recentBlockhash: blockhash, instructions: ixs }).compileToV0Message());
  const MAX = 1232;
  // Prefer a priority fee; drop the compute-budget instructions only when the coin's name/uri leave no room for them.
  let tx1 = build([...budget(400000, 150000), ...createIxs]);
  if (tx1.serialize().length > MAX) tx1 = build(createIxs);
  if (tx1.serialize().length > MAX) throw new Error('The coin name, ticker and metadata link are too long to fit in one Solana transaction. Shorten the name.');
  const tx2 = build([...budget(200000, 150000), ...feeIxs]);
  return { mint: mint.publicKey.toBase58(), mintKeypair: mint, txs: [tx1, tx2], blockhash, lastValidBlockHeight };
}

async function sendAndConfirm(tx, blockhash, lastValidBlockHeight) {
  const raw = tx.serialize();
  const sig = await connection.sendRawTransaction(raw, { skipPreflight: false, maxRetries: 3 });
  const res = await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
  if (res.value.err) throw Object.assign(new Error('Transaction failed on-chain: ' + JSON.stringify(res.value.err)), { signature: sig });
  return sig;
}

/** signed = the wallet-signed [tx1, tx2]. onStep(i) fires as each lands. */
export async function finishLaunch(prepared, signed, onStep) {
  need();
  const [t1, t2] = signed;
  t1.sign([prepared.mintKeypair]);
  const sig1 = await sendAndConfirm(t1, prepared.blockhash, prepared.lastValidBlockHeight);
  onStep && onStep(0, sig1);
  const sig2 = await sendAndConfirm(t2, prepared.blockhash, prepared.lastValidBlockHeight);
  onStep && onStep(1, sig2);
  return { mint: prepared.mint, signatures: [sig1, sig2] };
}

/** Rebuild just the fee-split transaction (for a retry after tx 1 landed but tx 2 did not). */
export async function prepareFeeSplit({ user, mint, computeWallet, computeShareBps }) {
  need();
  const userKey = new PublicKey(user), mintKey = new PublicKey(mint), compute = new PublicKey(computeWallet);
  const share = Math.round(computeShareBps);
  const shareholders = share >= 10000 ? [{ address: compute, shareBps: 10000 }] : [{ address: compute, shareBps: share }, { address: userKey, shareBps: 10000 - share }];
  const ixs = [
    await PUMP_SDK.createFeeSharingConfig({ creator: userKey, mint: mintKey, pool: null }),
    await PUMP_SDK.updateFeeShares({ authority: userKey, mint: mintKey, currentShareholders: [userKey], newShareholders: shareholders }),
  ];
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
  const tx = new VersionedTransaction(new TransactionMessage({ payerKey: userKey, recentBlockhash: blockhash, instructions: [ComputeBudgetProgram.setComputeUnitLimit({ units: 200000 }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 150000 }), ...ixs] }).compileToV0Message());
  return { tx, blockhash, lastValidBlockHeight };
}
export async function sendSigned(tx, blockhash, lastValidBlockHeight) { need(); return sendAndConfirm(tx, blockhash, lastValidBlockHeight); }

export const version = '1.0.0';
// test hook: inject program state without RPC
export function _setState(g, f) { cachedGlobal = g; cachedFeeConfig = f; }
export function _setConnection(c) { connection = c; online = new OnlinePumpSdk(c); }
