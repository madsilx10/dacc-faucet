const axios = require("axios");
const readline = require("readline");
const { ethers } = require("ethers");
require("dotenv").config();

const BASE_URL = "https://inception.dachain.io";
const UA = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36";
const CRATE_LIMIT = 5;
const CONTRACT = "0x3691A78bE270dB1f3b1a86177A8f23F89A8Cef24";
const RPC_URL = "https://rpctest.dachain.tech";
const CHAIN_ID = 21894;

const provider = new ethers.JsonRpcProvider(RPC_URL, { chainId: CHAIN_ID, name: "dacchain-testnet" }, { timeout: 60000 });

// ─── LOAD WALLETS ────────────────────────────────────────
function loadWallets() {
  const wallets = [];
  if (process.env.WALLET_FIRST) wallets.push({ index: "FIRST", address: process.env.WALLET_FIRST });
  let i = 1;
  while (process.env[`WALLET_${i}`]) {
    wallets.push({ index: i, address: process.env[`WALLET_${i}`] });
    i++;
  }
  return wallets;
}

function loadSigners() {
  const signers = {};
  if (process.env.PK_FIRST) {
    try { signers["FIRST"] = new ethers.Wallet(process.env.PK_FIRST, provider); } catch(e) { console.error("❌ PK_FIRST invalid"); }
  }
  let i = 1;
  while (process.env[`PK_${i}`]) {
    try { signers[i] = new ethers.Wallet(process.env[`PK_${i}`], provider); } catch(e) { console.error(`❌ PK_${i} invalid`); }
    i++;
  }
  return signers;
}

// ─── SELECT WALLETS ──────────────────────────────────────
async function selectWallets(wallets) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  console.log("\n📂 Wallet tersedia:");
  for (const w of wallets) console.log(`  [${w.index}] ${w.address}`);
  console.log(`  [ALL] Semua wallet`);
  console.log(`  [FROM X] Mulai dari wallet X sampai akhir`);

  return new Promise((resolve) => {
    rl.question("\nPilih wallet (contoh: FIRST, 1, ALL, FROM 4): ", (answer) => {
      rl.close();
      const input = answer.trim().toUpperCase();
      if (input === "ALL") return resolve(wallets);
      if (input.startsWith("FROM")) {
        const fromIndex = input.replace("FROM", "").trim();
        const idx = wallets.findIndex(w => String(w.index).toUpperCase() === fromIndex);
        if (idx === -1) { console.error("❌ Wallet tidak ditemukan."); process.exit(1); }
        return resolve(wallets.slice(idx));
      }
      const selected = wallets.filter(w => String(w.index).toUpperCase() === input);
      if (!selected.length) { console.error("❌ Tidak valid."); process.exit(1); }
      resolve(selected);
    });
  });
}

// ─── SELECT MODE ─────────────────────────────────────────
async function selectMode() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  console.log("\n🎯 Mode:");
  console.log("  [1] Faucet only");
  console.log("  [2] Crate only");
  console.log("  [3] Faucet + Crate");
  console.log("  [4] Burn");
  console.log("  [5] Stake");
  console.log("  [6] Claim Fees");
  console.log("  [7] Status wallet");
  console.log("  [8] All (Faucet + Crate + Burn + Stake + Claim Fees)");

  return new Promise((resolve) => {
    rl.question("\nPilih mode (1-8): ", (answer) => {
      rl.close();
      const input = answer.trim();
      if (!["1","2","3","4","5","6","7","8"].includes(input)) { console.error("❌ Tidak valid."); process.exit(1); }
      resolve(input);
    });
  });
}

// ─── API ─────────────────────────────────────────────────
async function login(walletAddress, csrf) {
  const cookie = `csrftoken=${csrf}`;
  const res = await axios.post(`${BASE_URL}/api/auth/wallet/`, { wallet_address: walletAddress }, {
    headers: { "Content-Type": "application/json", "Cookie": cookie, "X-Csrftoken": csrf, "Origin": BASE_URL, "Referer": `${BASE_URL}/`, "User-Agent": UA },
  });
  const newCookies = res.headers["set-cookie"];
  if (!newCookies) return cookie;
  return cookie + "; " + newCookies.map(c => c.split(";")[0]).join("; ");
}

async function getProfile(cookieStr, csrf) {
  const res = await axios.get(`${BASE_URL}/api/inception/profile/`, {
    headers: { "Cookie": cookieStr, "X-Csrftoken": csrf, "User-Agent": UA },
  });
  return res.data;
}

async function claimFaucet(cookieStr, csrf) {
  return await axios.post(`${BASE_URL}/api/inception/faucet/`, {}, {
    headers: { "Content-Type": "application/json", "Cookie": cookieStr, "X-Csrftoken": csrf, "Origin": BASE_URL, "Referer": `${BASE_URL}/faucet`, "User-Agent": UA, "Accept": "*/*" },
  });
}

async function openCrate(cookieStr, csrf) {
  return await axios.post(`${BASE_URL}/api/inception/crate/open/`, {}, {
    headers: { "Content-Type": "application/json", "Cookie": cookieStr, "X-Csrftoken": csrf, "Origin": BASE_URL, "Referer": `${BASE_URL}/quantum-crate`, "User-Agent": UA, "Accept": "*/*" },
  });
}

// ─── BLOCKCHAIN TX ───────────────────────────────────────
async function sendTx(signer, data, value = "0") {
  const tx = await signer.sendTransaction({
    to: CONTRACT,
    data: data,
    value: ethers.parseEther(value),
    gasLimit: 100000,
  });
  return tx;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── FAUCET ──────────────────────────────────────────────
async function doFaucet(cookieStr, csrf) {
  let attempt = 0;
  while (true) {
    attempt++;
    process.stdout.write(`  💧 Claim faucet (attempt ${attempt}) ... `);
    try {
      const res = await claimFaucet(cookieStr, csrf);
      if (res.status === 202) { console.log("✅ Accepted!"); return true; }
      else { console.log(`⚠️ Status: ${res.status}, retry...`); await sleep(5000); }
    } catch (err) {
      const msg = err.response?.data?.detail || err.response?.data?.message || err.response?.data?.error || err.message;
      const status = err.response?.status;
      console.log(`❌ [${status}] ${msg}`);
      if (msg && (msg.toLowerCase().includes("cooldown") || msg.toLowerCase().includes("already") || msg.toLowerCase().includes("available in"))) {
        console.log("  ⏰ Masih cooldown, skip."); return false;
      } else if (status === 403) { console.log("  🚫 403, skip."); return false; }
      else { console.log("  🔄 Retry dalam 5 detik..."); await sleep(5000); }
    }
  }
}

// ─── CRATE ───────────────────────────────────────────────
async function doCrate(cookieStr, csrf) {
  let success = 0;
  for (let i = 1; i <= CRATE_LIMIT; i++) {
    let claimed = false;
    while (!claimed) {
      process.stdout.write(`  📦 Claim crate (${i}/${CRATE_LIMIT}) ... `);
      try {
        const res = await openCrate(cookieStr, csrf);
        if (res.status === 200) { console.log("✅ Opened!"); success++; claimed = true; }
        else { console.log(`⚠️ Status: ${res.status}, retry...`); await sleep(5000); }
      } catch (err) {
        const msg = err.response?.data?.detail || err.response?.data?.message || err.response?.data?.error || err.message;
        const status = err.response?.status;
        console.log(`❌ [${status}] ${msg}`);
        if (msg && (msg.toLowerCase().includes("limit") || msg.toLowerCase().includes("already") || msg.toLowerCase().includes("available in"))) {
          console.log("  ⏰ Limit, skip crate."); return success;
        } else { console.log("  🔄 Retry dalam 5 detik..."); await sleep(5000); }
      }
    }
    if (i < CRATE_LIMIT) {
      for (let s = 10; s >= 0; s--) {
        process.stdout.write(`\r  ⏳ Jeda ${s} detik  `);
        await sleep(1000);
      }
      process.stdout.write("\n");
    }
  }
  return success;
}

// ─── BURN ────────────────────────────────────────────────
async function doBurn(signer, amount) {
  process.stdout.write(`  🔥 Burn ${amount} DACC ... `);
  try {
    const tx = await sendTx(signer, "0x4a5d094b", amount);
    console.log(`✅ TX: ${tx.hash}`);
    return true;
  } catch (err) {
    console.log(`❌ ${err.message}`);
    return false;
  }
}

// ─── STAKE ───────────────────────────────────────────────
async function doStake(signer, amount) {
  process.stdout.write(`  💎 Stake ${amount} DACC ... `);
  try {
    const tx = await sendTx(signer, "0x3a4b66f1", amount);
    console.log(`✅ TX: ${tx.hash}`);
    return true;
  } catch (err) {
    console.log(`❌ ${err.message}`);
    return false;
  }
}

// ─── CLAIM FEES ──────────────────────────────────────────
async function doClaimFees(signer) {
  process.stdout.write(`  💰 Claim fees ... `);
  try {
    const tx = await sendTx(signer, "0xd294f093", "0");
    console.log(`✅ TX: ${tx.hash}`);
    return true;
  } catch (err) {
    console.log(`❌ ${err.message}`);
    return false;
  }
}

// ─── STATUS ──────────────────────────────────────────────
async function doStatus(wallets, csrf) {
  console.log("\n📊 Status Wallet:\n");
  for (const w of wallets) {
    process.stdout.write(`[${w.index}] ${w.address} ... `);
    try {
      // Login dengan retry
      let cookieStr;
      let loginAttempt = 0;
      while (!cookieStr) {
        loginAttempt++;
        try {
          cookieStr = await login(w.address, csrf);
        } catch (e) {
          process.stdout.write(`\n  ⚠️ Retry login (${loginAttempt})...`);
          await sleep(5000);
        }
      }

      // Profile dengan retry
      let profile;
      let profileAttempt = 0;
      while (!profile) {
        profileAttempt++;
        try {
          profile = await getProfile(cookieStr, csrf);
        } catch (e) {
          process.stdout.write(`\n  ⚠️ Retry profile (${profileAttempt})...`);
          await sleep(5000);
        }
      }

      // Cek crate history dengan retry
      let crateRes;
      let crateAttempt = 0;
      while (!crateRes) {
        crateAttempt++;
        try {
          crateRes = await axios.get(`${BASE_URL}/api/inception/crate/history/`, {
            headers: { "Cookie": cookieStr, "X-Csrftoken": csrf, "Referer": `${BASE_URL}/quantum-crate`, "User-Agent": UA },
          });
        } catch (e) {
          process.stdout.write(`\n  ⚠️ Retry crate history (${crateAttempt})...`);
          await sleep(5000);
        }
      }
      const crateData = crateRes.data;
      const opensToday = crateData.opens_today || 0;
      const crateLimit = crateData.daily_open_limit || 5;

      const faucetStatus = profile.faucet_available 
        ? "✅ Bisa claim" 
        : `❌ Cooldown ${Math.floor(profile.faucet_seconds_left / 3600)}j ${Math.floor((profile.faucet_seconds_left % 3600) / 60)}m`;
      const crateStatus = opensToday >= crateLimit 
        ? `✅ Sudah claim semua (${opensToday}/${crateLimit})`
        : `❌ Baru ${opensToday}/${crateLimit}`;

      console.log(`\n  💎 Balance : ${profile.dacc_balance} DACC`);
      console.log(`  💧 Faucet  : ${faucetStatus}`);
      console.log(`  📦 Crate   : ${crateStatus}`);
    } catch (err) {
      console.log(`❌ Error: ${err.message}`);
    }
    await sleep(1000);
  }

  console.log("\n");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question("Tekan ENTER untuk kembali ke menu...", () => { rl.close(); resolve(); });
  });
}

// ─── INPUT AMOUNT ────────────────────────────────────────
async function inputAmount(label) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`\nMasukkan jumlah ${label} (DACC): `, (answer) => {
      rl.close();
      const val = parseFloat(answer.trim());
      if (isNaN(val) || val <= 0) { console.error("❌ Jumlah tidak valid."); process.exit(1); }
      resolve(val.toString());
    });
  });
}

// ─── MAIN ────────────────────────────────────────────────
async function main() {
  console.log("🚀 DACChain Bot — Faucet, Crate, Burn, Stake, Claim Fees");
  console.log(`🌐 ${BASE_URL}\n`);

  const csrf = process.env.CSRF_TOKEN;
  if (!csrf) { console.error("❌ CSRF_TOKEN tidak ada di .env!"); process.exit(1); }

  const wallets = loadWallets();
  if (!wallets.length) { console.error("❌ Tidak ada wallet di .env!"); process.exit(1); }

  const signers = loadSigners();

  while (true) {
    const mode = await selectMode();

    if (mode === "7") {
      await doStatus(wallets, csrf);
      continue;
    }

    const selected = await selectWallets(wallets);

    let burnAmount = "0", stakeAmount = "0";
    if (mode === "4" || mode === "8") burnAmount = await inputAmount("Burn");
    if (mode === "5" || mode === "8") stakeAmount = await inputAmount("Stake");

    console.log(`\n✅ ${selected.length} wallet dipilih\n`);

    for (let i = 0; i < selected.length; i++) {
      const { index, address } = selected[i];
      console.log(`\n[${i + 1}/${selected.length}] Wallet [${index}]: ${address}`);

      // Login (dengan retry)
      let cookieStr = null;
      let loginAttempt = 0;
      while (!cookieStr) {
        loginAttempt++;
        process.stdout.write(`  🔑 Login (attempt ${loginAttempt}) ... `);
        try { cookieStr = await login(address, csrf); console.log("✅"); }
        catch (err) { console.log(`❌ ${err.message}`); console.log("  🔄 Retry dalam 5 detik..."); await sleep(5000); }
      }

      // Tampil balance kalau mode burn/stake/claim fees
      if (["4","5","6","8"].includes(mode)) {
        try {
          const profile = await getProfile(cookieStr, csrf);
          console.log(`  💎 Balance : ${profile.dacc_balance} DACC`);
        } catch (e) {}
      }

      if (mode === "1" || mode === "3" || mode === "8") await doFaucet(cookieStr, csrf);
      if (mode === "2" || mode === "3" || mode === "8") await doCrate(cookieStr, csrf);

      const signer = signers[index];
      if (mode === "4" || mode === "8") {
        if (signer) await doBurn(signer, burnAmount);
        else console.log(`  ⚠️ PK_${index} tidak ada di .env, skip burn.`);
      }
      if (mode === "5" || mode === "8") {
        if (signer) await doStake(signer, stakeAmount);
        else console.log(`  ⚠️ PK_${index} tidak ada di .env, skip stake.`);
      }
      if (mode === "6" || mode === "8") {
        if (signer) await doClaimFees(signer);
        else console.log(`  ⚠️ PK_${index} tidak ada di .env, skip claim fees.`);
      }

      if (i < selected.length - 1) {
        console.log("  ⏳ Jeda 3 detik...");
        await sleep(3000);
      }
    }

    console.log(`\n─────────────────────────────`);
    console.log(`✅ Selesai!`);
    console.log(`─────────────────────────────\n`);
  }
}

main().catch(console.error);
