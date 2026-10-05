import assert from "node:assert/strict";
import { createServer } from "node:http";
import { constants, mkdirSync, realpathSync, lstatSync, openSync, closeSync, readFileSync, writeFileSync, fsyncSync } from "node:fs";
import { join, resolve } from "node:path";
import { decodeFunctionData, encodeFunctionData, formatUnits, keccak256, parseTransaction, recoverTransactionAddress, serializeTransaction, TransactionNotFoundError } from "viem";
import { decodeProgrammeDepositQuoteV3 } from "@raceson/domain/rewards/programme-deposit-v3";
import { rewardProgrammeV3Abi } from "@raceson/rewards-chain/programme-v3";

export const LOCAL_WALLET_RPC_PORT = 18547;
const amount = v => { assert.ok(typeof v === "string" && /^0x(?:0|[1-9a-f][0-9a-f]{0,63})$/i.test(v)); return BigInt(v); };
const address = v => { assert.ok(typeof v === "string" && /^0x[0-9a-f]{40}$/i.test(v) && BigInt(v) > 0n); return v.toLowerCase(); };
const hash = v => assert.match(v, /^0x[0-9a-f]{64}$/i);
const block = v => assert.ok(["latest", "pending", "finalized", "safe", "earliest"].includes(v) || typeof v === "string" && /^0x(?:0|[1-9a-f][0-9a-f]{0,15})$/i.test(v));
const noParams = new Set(["eth_chainId", "eth_blockNumber", "eth_gasPrice", "eth_maxPriorityFeePerGas", "net_version", "web3_clientVersion", "eth_accounts"]);
const MAX_GAS = 500000n, MAX_FEE = 100000000000n;

export function walletRpcBinding(value) {
  assert.deepEqual(Object.keys(value).sort(), ["address", "budgetWei", "chainId", "draftId", "funderAddress"]);
  assert.equal(value.chainId, 31337); assert.match(value.draftId, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  assert.match(value.budgetWei, /^[1-9][0-9]{0,77}$/); assert.ok(BigInt(value.budgetWei) < (1n << 256n));
  return { chainId: 31337, draftId: value.draftId, address: address(value.address), funderAddress: address(value.funderAddress), budgetWei: value.budgetWei };
}
function depositCall(input, bound) {
  assert.ok(input && !Array.isArray(input) && typeof input === "object");
  const allowed = ["from", "to", "data", "value", "gas", "gasPrice", "maxFeePerGas", "maxPriorityFeePerGas", "nonce", "chainId", "type", "accessList"];
  assert.ok(Object.keys(input).every(k => allowed.includes(k)));
  assert.equal(address(input.from), bound.funderAddress); assert.equal(address(input.to), bound.address);
  if (input.chainId !== undefined) assert.equal(amount(input.chainId), 31337n);
  if (input.type !== undefined) assert.equal(input.type, "0x2");
  if (input.accessList !== undefined) assert.deepEqual(input.accessList, []);
  if (input.nonce !== undefined) assert.ok(amount(input.nonce) <= BigInt(Number.MAX_SAFE_INTEGER));
  if (input.gas !== undefined) assert.ok(amount(input.gas) > 0n && amount(input.gas) <= MAX_GAS);
  for (const k of ["gasPrice", "maxFeePerGas", "maxPriorityFeePerGas"]) if (input[k] !== undefined) assert.ok(amount(input[k]) <= MAX_FEE);
  const value = amount(input.value); assert.ok(value > 0n && value <= BigInt(bound.budgetWei));
  assert.ok(typeof input.data === "string" && /^0x[0-9a-f]{72}$/i.test(input.data));
  const decoded = decodeFunctionData({ abi: rewardProgrammeV3Abi, data: input.data });
  assert.equal(decoded.functionName, "deposit");
  const expectedDeposited = decoded.args[0]; assert.ok(expectedDeposited + value <= BigInt(bound.budgetWei));
  assert.equal(input.data.toLowerCase(), encodeFunctionData({ abi: rewardProgrammeV3Abi, functionName: "deposit", args: [expectedDeposited] }));
  return { value, expectedDeposited, data: input.data.toLowerCase() };
}

export async function verifyLocalWalletDeposit(serialized, binding) {
  const bound = walletRpcBinding(binding);
  assert.ok(typeof serialized === "string" && /^0x02(?:[0-9a-f]{2}){1,1023}$/i.test(serialized));
  const raw = serialized.toLowerCase(), tx = parseTransaction(raw);
  assert.equal(tx.type, "eip1559"); assert.equal(tx.chainId, 31337); assert.equal(tx.accessList?.length ?? 0, 0);
  assert.ok(Number.isSafeInteger(tx.nonce) && tx.nonce >= 0 && tx.r && tx.s && [0, 1].includes(tx.yParity));
  assert.ok(tx.gas > 0n && tx.gas <= MAX_GAS && tx.maxFeePerGas > 0n && tx.maxFeePerGas <= MAX_FEE
    && (tx.maxPriorityFeePerGas ?? 0n) <= tx.maxFeePerGas);
  assert.equal(serializeTransaction(tx), raw);
  const from = (await recoverTransactionAddress({ serializedTransaction: raw })).toLowerCase();
  const call = depositCall({ from, to: tx.to, data: tx.data, value: `0x${(tx.value ?? 0n).toString(16)}` }, bound);
  return { raw, tx, from, ...call, transactionHash: keccak256(raw) };
}

export function validateWalletRpcRequest(value, bound) {
  assert.ok(value && !Array.isArray(value) && typeof value === "object");
  assert.ok(Object.keys(value).every(k => ["jsonrpc", "id", "method", "params"].includes(k)));
  assert.equal(value.jsonrpc, "2.0"); assert.ok(typeof value.id === "string" && value.id.length <= 64 || Number.isSafeInteger(value.id));
  const p = value.params ?? []; assert.ok(Array.isArray(p));
  const exact = n => assert.equal(p.length, n);
  if (noParams.has(value.method)) exact(0);
  else if (["eth_getBalance", "eth_getCode", "eth_getTransactionCount"].includes(value.method)) {
    exact(2); assert.ok([bound.address, bound.funderAddress].includes(address(p[0]))); block(p[1]);
  } else if (["eth_getTransactionByHash", "eth_getTransactionReceipt"].includes(value.method)) { exact(1); hash(p[0]); }
  else if (value.method === "eth_getBlockByNumber") { exact(2); block(p[0]); assert.equal(p[1], false); }
  else if (value.method === "eth_getBlockByHash") { exact(2); hash(p[0]); assert.equal(p[1], false); }
  else if (value.method === "eth_feeHistory") {
    exact(3); assert.ok(amount(p[0]) > 0n && amount(p[0]) <= 20n); block(p[1]);
    assert.ok(Array.isArray(p[2]) && p[2].length <= 10 && p[2].every((v, i, all) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 100 && (i === 0 || v >= all[i - 1])));
  } else if (value.method === "eth_estimateGas") {
    assert.ok(p.length === 1 || p.length === 2 && ["latest", "pending"].includes(p[1])); depositCall(p[0], bound);
  } else if (value.method === "eth_sendRawTransaction") { exact(1); assert.ok(typeof p[0] === "string" && /^0x02(?:[0-9a-f]{2}){1,1023}$/i.test(p[0])); }
  else throw Error("unsupported_local_wallet_method");
  return { jsonrpc: "2.0", id: value.id, method: value.method, params: p };
}

// Immutable public attempt metadata only. Raw signed bytes remain in the wallet
// and transient request memory. No secrets or RPC payloads are logged/exported.
function retainAttempt(directory, bound, signed) {
  const filename = join(directory, `${signed.from.slice(2)}-${signed.tx.nonce}.json`);
  const text = JSON.stringify({ version: 1, chainId: 31337, draftId: bound.draftId, from: signed.from, nonce: signed.tx.nonce,
    to: bound.address, valueWei: signed.value.toString(), expectedDepositedWei: signed.expectedDeposited.toString(), transactionHash: signed.transactionHash });
  let fd;
  try {
    fd = openSync(filename, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    writeFileSync(fd, text); fsyncSync(fd);
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    const info = lstatSync(filename); assert.ok(info.isFile() && info.nlink === 1 && info.size <= 1024 && (info.mode & 0o077) === 0);
    const existing = openSync(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
    try { assert.equal(readFileSync(existing, "utf8"), text, "local_wallet_nonce_already_reserved"); } finally { closeSync(existing); }
  } finally { if (fd !== undefined) closeSync(fd); }
  const parent = openSync(directory, constants.O_RDONLY); try { fsyncSync(parent); } finally { closeSync(parent); }
}

/** Caller must own this loopback chain. No endpoint, key, source approval or
 * destination can be chosen by an HTTP client. Only one programme per session.
 * access/review are private live-Auth reads, never supplied over wallet RPC. */
export async function startProgrammeWalletRpc({ client, binding, access, review, journalDirectory, port = LOCAL_WALLET_RPC_PORT, alive = () => true }) {
  const bound = walletRpcBinding(binding), inputDirectory = resolve(journalDirectory);
  assert.equal(inputDirectory, journalDirectory); assert.equal(client.chain.id, 31337); assert.equal(await client.getChainId(), 31337);
  const endpoint = new URL(client.chain.rpcUrls.default.http[0]);
  assert.ok(endpoint.protocol === "http:" && endpoint.hostname === "127.0.0.1" && endpoint.port && endpoint.pathname === "/" && !endpoint.username && !endpoint.password && !endpoint.search && !endpoint.hash);
  assert.ok(port === LOCAL_WALLET_RPC_PORT || port === 0);
  mkdirSync(inputDirectory, { recursive: true, mode: 0o700 });
  assert.equal(realpathSync(inputDirectory), inputDirectory); assert.equal(lstatSync(inputDirectory).mode & 0o077, 0);
  let stopped = false, sending = false, concurrent = 0, bucket = Date.now(), count = 0;
  const live = () => assert.ok(!stopped && alive(), "local_wallet_session_closed");
  const accessible = async () => { live(); assert.deepEqual(walletRpcBinding(await access()), bound); live(); };
  async function reviewed(call) {
    const result = await review(formatUnits(call.value, 18)); live(); assert.equal(result.status, "ready");
    const q = decodeProgrammeDepositQuoteV3(result.quote);
    assert.equal(q.draftId, bound.draftId); assert.equal(q.address, bound.address); assert.equal(q.funderAddress, bound.funderAddress); assert.equal(q.budgetWei, bound.budgetWei);
    assert.equal(q.amountWei, call.value.toString()); assert.equal(q.expectedDepositedWei, call.expectedDeposited.toString()); assert.ok(Date.now() < Date.parse(q.expiresAt));
    return q;
  }
  async function execute(request) {
    live();
    if (request.method === "eth_accounts") return []; // No unlocked/server-owned accounts.
    if (request.method === "web3_clientVersion") return "RacesOn/local-wallet-rpc-v1";
    if (request.method === "eth_estimateGas") {
      await accessible(); const call = depositCall(request.params[0], bound); await reviewed(call);
      const result = await client.request({ method: request.method, params: request.params });
      assert.ok(amount(result) <= MAX_GAS); await accessible(); return result;
    }
    if (request.method !== "eth_sendRawTransaction") return client.request({ method: request.method, params: request.params });
    assert.ok(!sending, "local_wallet_send_busy"); sending = true;
    try {
      const signed = await verifyLocalWalletDeposit(request.params[0], bound); await accessible();
      let known;
      try { known = await client.getTransaction({ hash: signed.transactionHash }); }
      catch (error) { if (!(error instanceof TransactionNotFoundError)) throw error; }
      if (known) {
        assert.equal(known.hash, signed.transactionHash); assert.equal(known.from.toLowerCase(), bound.funderAddress);
        assert.equal(known.to?.toLowerCase(), bound.address); assert.equal(known.chainId, 31337); assert.equal(known.nonce, signed.tx.nonce);
        assert.equal(known.value, signed.value); assert.equal(known.input, signed.data); await accessible(); return signed.transactionHash;
      }
      assert.equal(await client.getChainId(), 31337);
      const nonce = await client.getTransactionCount({ address: bound.funderAddress, blockTag: "pending" });
      assert.equal(nonce, signed.tx.nonce, "local_wallet_nonce_changed");
      assert.ok(await client.getBalance({ address: bound.funderAddress, blockTag: "pending" }) >= signed.value + signed.tx.gas * signed.tx.maxFeePerGas);
      const q = await reviewed(signed); // Final live approval/session check after provider IO.
      retainAttempt(inputDirectory, bound, signed); live(); assert.ok(Date.now() < Date.parse(q.expiresAt));
      // No await between this fence and release; never replace fees or retry here.
      const accepted = await client.sendRawTransaction({ serializedTransaction: signed.raw }); assert.equal(accepted, signed.transactionHash); return accepted;
    } finally { sending = false; }
  }
  const server = createServer(async (req, res) => {
    res.setHeader("Content-Type", "application/json"); res.setHeader("Cache-Control", "no-store");
    let id = null, admitted = false;
    try {
      live(); assert.equal(req.headers.host, `127.0.0.1:${server.address().port}`); assert.equal(req.url, "/");
      assert.ok(!req.headers.authorization && !req.headers.cookie && !req.headers.apikey);
      const origin = req.headers.origin;
      assert.ok(origin === undefined || origin === "http://127.0.0.1:3101" || /^chrome-extension:\/\/[a-p]{32}$/.test(origin));
      if (origin) { res.setHeader("Access-Control-Allow-Origin", origin); res.setHeader("Vary", "Origin"); }
      if (req.method === "OPTIONS") {
        assert.equal(req.headers["access-control-request-method"], "POST");
        assert.ok((req.headers["access-control-request-headers"] ?? "").split(",").map(s => s.trim().toLowerCase()).every(v => v === "" || v === "content-type"));
        res.setHeader("Access-Control-Allow-Methods", "POST"); res.setHeader("Access-Control-Allow-Headers", "Content-Type");
        res.setHeader("Access-Control-Allow-Private-Network", "true"); res.statusCode = 204; res.end(); return;
      }
      assert.equal(req.method, "POST"); assert.match(req.headers["content-type"] ?? "", /^application\/json(?:\s*;|$)/i);
      if (Date.now() - bucket >= 1000) { bucket = Date.now(); count = 0; }
      assert.ok(++count <= 30 && concurrent < 8); concurrent++; admitted = true;
      const chunks = []; let size = 0;
      for await (const chunk of req) { size += chunk.length; assert.ok(size <= 8192); chunks.push(chunk); }
      const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (parsed && !Array.isArray(parsed) && (typeof parsed.id === "string" && parsed.id.length <= 64 || Number.isSafeInteger(parsed.id))) id = parsed.id;
      const request = validateWalletRpcRequest(parsed, bound), result = await execute(request);
      const body = JSON.stringify({ jsonrpc: "2.0", id: request.id, result }); assert.ok(body.length <= 2 * 1024 * 1024); res.end(body);
    } catch { res.end(JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32000, message: "Local wallet request refused or unresolved. No automatic retry. Check the exact transaction hash before sending again." } })); }
    finally { if (admitted) concurrent--; }
  });
  server.requestTimeout = 10000; server.headersTimeout = 10000; server.maxConnections = 32;
  await accessible();
  await new Promise((accept, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", accept); });
  return { url: `http://127.0.0.1:${server.address().port}`, binding: bound,
    stop: () => { stopped = true; server.close(); server.closeAllConnections(); } };
}
