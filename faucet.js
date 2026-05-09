const axios = require("axios");
const readline = require("readline");
require("dotenv").config();

const BASE_URL = "https://inception.dachain.io";
const UA = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36";
const CRATE_LIMIT = 5;
const CRATE_DELAY = 15000; // 30 detik

function loadWallets() {
  const wallets = [];
  if (process.env.WALLET_FIRST) {
    wallets.push({ index: "FIRST", address: process.env.WALLET_FIRST });
  }
  let i = 1;
  while (process.env[`WALLET_${i}`]) {
    wallets.push({ index: i, address: process.env[`WALLET_${i}`] });
    i++;
  }
  return wallets;
}

async function selectWallets(wallets) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  console.log("\n📂 Wallet tersedia:");
  for (const w of wallets) console.log(`  [${w.index}] ${w.address}`);
  console.log(`  [ALL] Semua wallet`);
  console.log(`  [FROM 4] Mulai dari wallet 4 sampai akhir`);

  return new Promise((resolve) => {
    rl.question("\nPilih wallet (contoh: FIRST, 1, ALL, atau FROM 4): ", (answer) => {
      rl.close();
      const input = answer.trim().toUpperCase();

      if (input === "ALL") return resolve(wallets);

      // FROM X — mulai dari wallet X sampai akhir
      if (input.startsWith("FROM")) {
        const fromIndex = input.replace("FROM", "").trim();
        const idx = wallets.findIndex(w => String(w.index).toUpperCase() === fromIndex);
        if (idx === -1) { console.error("❌ Wallet tidak ditemukan."); process.exit(1); }
        return resolve(wallets.slice(idx));
      }

      // Single wallet
      const selected = wallets.filter(w => String(w.index).toUpperCase() === input);
      if (!selected.length) { console.error("❌ Tidak valid."); process.exit(1); }
      resolve(selected);
    });
  });
}

async function selectMode() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  console.log("\n🎯 Mode:");
  console.log("  [1] Faucet only");
  console.log("  [2] Crate only");
  console.log("  [3] Faucet + Crate");

  return new Promise((resolve) => {
    rl.question("\nPilih mode (1/2/3): ", (answer) => {
      rl.close();
      const input = answer.trim();
      if (!["1","2","3"].includes(input)) { console.error("❌ Tidak valid."); process.exit(1); }
      resolve(input);
    });
  });
}

async function login(walletAddress, csrf) {
  const cookie = `csrftoken=${csrf}`;
  const res = await axios.post(
    `${BASE_URL}/api/auth/wallet/`,
    { wallet_address: walletAddress },
    {
      headers: {
        "Content-Type": "application/json",
        "Cookie": cookie,
        "X-Csrftoken": csrf,
        "Origin": BASE_URL,
        "Referer": `${BASE_URL}/`,
        "User-Agent": UA,
      },
    }
  );
  const newCookies = res.headers["set-cookie"];
  if (!newCookies) return cookie;
  const newCookieStr = newCookies.map(c => c.split(";")[0]).join("; ");
  return cookie + "; " + newCookieStr;
}

async function claimFaucet(cookieStr, csrf) {
  return await axios.post(
    `${BASE_URL}/api/inception/faucet/`,
    {},
    {
      headers: {
        "Content-Type": "application/json",
        "Cookie": cookieStr,
        "X-Csrftoken": csrf,
        "Origin": BASE_URL,
        "Referer": `${BASE_URL}/faucet`,
        "User-Agent": UA,
        "Accept": "*/*",
      },
    }
  );
}

async function openCrate(cookieStr, csrf) {
  return await axios.post(
    `${BASE_URL}/api/inception/crate/open/`,
    {},
    {
      headers: {
        "Content-Type": "application/json",
        "Cookie": cookieStr,
        "X-Csrftoken": csrf,
        "Origin": BASE_URL,
        "Referer": `${BASE_URL}/quantum-crate`,
        "User-Agent": UA,
        "Accept": "*/*",
      },
    }
  );
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function doFaucet(cookieStr, csrf) {
  let attempt = 0;
  while (true) {
    attempt++;
    process.stdout.write(`  💧 Claim faucet (attempt ${attempt}) ... `);
    try {
      const res = await claimFaucet(cookieStr, csrf);
      if (res.status === 202) {
        console.log("✅ Accepted!");
        return true;
      } else {
        console.log(`⚠️ Status: ${res.status}, retry...`);
        await sleep(5000);
      }
    } catch (err) {
      const msg = err.response?.data?.detail || err.response?.data?.message || err.response?.data?.error || err.message;
      const status = err.response?.status;
      console.log(`❌ [${status}] ${msg}`);
      if (msg && (msg.toLowerCase().includes("cooldown") || msg.toLowerCase().includes("already") || msg.toLowerCase().includes("available in"))) {
        console.log("  ⏰ Masih cooldown, skip.");
        return false;
      } else if (status === 403) {
        console.log("  🚫 403, skip.");
        return false;
      } else {
        console.log("  🔄 Retry dalam 5 detik...");
        await sleep(5000);
      }
    }
  }
}

async function doCrate(cookieStr, csrf) {
  let success = 0;
  for (let i = 1; i <= CRATE_LIMIT; i++) {
    let claimed = false;
    while (!claimed) {
      process.stdout.write(`  📦 Claim crate (${i}/${CRATE_LIMIT}) ... `);
      try {
        const res = await openCrate(cookieStr, csrf);
        if (res.status === 200) {
          console.log("✅ Opened!");
          success++;
          claimed = true;
        } else {
          console.log(`⚠️ Status: ${res.status}, retry...`);
          await sleep(5000);
        }
      } catch (err) {
        const msg = err.response?.data?.detail || err.response?.data?.message || err.response?.data?.error || err.message;
        const status = err.response?.status;
        console.log(`❌ [${status}] ${msg}`);
        if (msg && (msg.toLowerCase().includes("limit") || msg.toLowerCase().includes("already") || msg.toLowerCase().includes("available in"))) {
          console.log("  ⏰ Limit, skip crate.");
          return success;
        } else {
          console.log("  🔄 Retry dalam 5 detik...");
          await sleep(5000);
        }
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

async function main() {
  console.log("🚀 DACChain Bot — Faucet & Crate");
  console.log(`🌐 ${BASE_URL}\n`);

  const csrf = process.env.CSRF_TOKEN;
  if (!csrf) { console.error("❌ CSRF_TOKEN tidak ada di .env!"); process.exit(1); }

  const wallets = loadWallets();
  if (!wallets.length) { console.error("❌ Tidak ada wallet di .env!"); process.exit(1); }

  const selected = await selectWallets(wallets);
  const mode = await selectMode();

  console.log(`\n✅ ${selected.length} wallet dipilih | Mode: ${mode === "1" ? "Faucet" : mode === "2" ? "Crate" : "Faucet + Crate"}\n`);

  for (let i = 0; i < selected.length; i++) {
    const { index, address } = selected[i];
    console.log(`\n[${i + 1}/${selected.length}] Wallet [${index}]: ${address}`);

    try {
    let cookieStr = null;
    let loginAttempt = 0;
    while (!cookieStr) {
      loginAttempt++;
      process.stdout.write(`  🔑 Login (attempt ${loginAttempt}) ... `);
      try {
        cookieStr = await login(address, csrf);
        console.log("✅");
      } catch (err) {
        console.log(`❌ ${err.message}`);
        console.log("  🔄 Retry login dalam 5 detik...");
        await sleep(5000);
      }
    }

      if (mode === "1" || mode === "3") await doFaucet(cookieStr, csrf);
      if (mode === "2" || mode === "3") await doCrate(cookieStr, csrf);

    } catch (err) {
      console.log(`❌ Error: ${err.message}`);
    }

    if (i < selected.length - 1) {
      console.log("  ⏳ Jeda 3 detik sebelum wallet berikutnya...");
      await sleep(3000);
    }
  }

  console.log(`\n─────────────────────────────`);
  console.log(`✅ Semua selesai!`);
  console.log(`─────────────────────────────`);
}

main().catch(console.error);
