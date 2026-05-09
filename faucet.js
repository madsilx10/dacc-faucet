const axios = require("axios");
const readline = require("readline");
require("dotenv").config();

const BASE_URL = "https://inception.dachain.io";
const UA = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36";

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
  for (const w of wallets) {
    console.log(`  [${w.index}] ${w.address}`);
  }
  console.log(`  [ALL] Semua wallet`);

  return new Promise((resolve) => {
    rl.question("\nPilih wallet (contoh: FIRST, 1, 2, atau ALL): ", (answer) => {
      rl.close();
      const input = answer.trim().toUpperCase();
      if (input === "ALL") {
        resolve(wallets);
      } else {
        const selected = wallets.filter(w => String(w.index).toUpperCase() === input);
        if (selected.length === 0) {
          console.error("❌ Pilihan tidak valid.");
          process.exit(1);
        }
        resolve(selected);
      }
    });
  });
}

async function getCsrf() {
  const res = await axios.get(BASE_URL, {
    headers: {
      "User-Agent": UA,
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
  });

  const cookies = res.headers["set-cookie"];
  if (!cookies) throw new Error("Gagal dapat csrf cookie!");

  const cookieStr = cookies.map(c => c.split(";")[0]).join("; ");
  const csrfMatch = cookieStr.match(/csrftoken=([^;]+)/);
  if (!csrfMatch) throw new Error("csrftoken tidak ditemukan!");

  return { cookieStr, csrf: csrfMatch[1] };
}

async function login(walletAddress, cookieStr, csrf) {
  const res = await axios.post(
    `${BASE_URL}/api/auth/wallet/`,
    { wallet_address: walletAddress },
    {
      headers: {
        "Content-Type": "application/json",
        "Cookie": cookieStr,
        "X-Csrftoken": csrf,
        "Origin": BASE_URL,
        "Referer": `${BASE_URL}/`,
        "User-Agent": UA,
      },
    }
  );

  const newCookies = res.headers["set-cookie"];
  if (!newCookies) return { cookieStr, csrf };

  const newCookieStr = newCookies.map(c => c.split(";")[0]).join("; ");
  const merged = cookieStr + "; " + newCookieStr;
  const csrfMatch = merged.match(/csrftoken=([^;]+)/);
  const newCsrf = csrfMatch ? csrfMatch[1] : csrf;

  return { cookieStr: merged, csrf: newCsrf };
}

async function claimFaucet(cookieStr, csrf) {
  const res = await axios.post(
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
  return res;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
  console.log("🚀 DACChain Faucet Bot");
  console.log(`🌐 ${BASE_URL}\n`);

  const wallets = loadWallets();
  if (wallets.length === 0) {
    console.error("❌ Tidak ada wallet di .env!");
    process.exit(1);
  }

  const selected = await selectWallets(wallets);
  console.log(`\n✅ ${selected.length} wallet dipilih\n`);

  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < selected.length; i++) {
    const { index, address } = selected[i];
    console.log(`[${i + 1}/${selected.length}] Wallet [${index}]: ${address}`);

    try {
      process.stdout.write("  🍪 Ambil CSRF ... ");
      const { cookieStr: initCookie, csrf: initCsrf } = await getCsrf();
      console.log("✅");

      process.stdout.write("  🔑 Login ... ");
      const { cookieStr, csrf } = await login(address, initCookie, initCsrf);
      console.log("✅");

      let claimed = false;
      let attempt = 0;

      while (!claimed) {
        attempt++;
        process.stdout.write(`  💧 Claim faucet (attempt ${attempt}) ... `);
        try {
          const res = await claimFaucet(cookieStr, csrf);
          if (res.status === 202) {
            console.log("✅ Accepted!");
            successCount++;
            claimed = true;
          } else {
            console.log(`⚠️ Status: ${res.status}, retry...`);
            await sleep(5000);
          }
        } catch (err) {
          const msg = err.response?.data?.detail || err.response?.data?.message || err.response?.data?.error || err.message;
          const status = err.response?.status;
          console.log(`❌ [${status}] ${msg}`);
          if (msg && (msg.toLowerCase().includes("cooldown") || msg.toLowerCase().includes("already"))) {
            console.log("  ⏰ Masih cooldown, skip.");
            failCount++;
            claimed = true;
          } else if (status === 403) {
            console.log("  🚫 403 Forbidden, skip.");
            failCount++;
            claimed = true;
          } else {
            console.log("  🔄 Retry dalam 5 detik...");
            await sleep(5000);
          }
        }
      }
    } catch (err) {
      console.log(`❌ Error: ${err.message}`);
      failCount++;
    }

    if (i < selected.length - 1) {
      console.log("  ⏳ Jeda 3 detik...\n");
      await sleep(3000);
    }
  }

  console.log(`\n─────────────────────────────`);
  console.log(`✅ Sukses : ${successCount}`);
  console.log(`❌ Gagal  : ${failCount}`);
  console.log(`─────────────────────────────`);
}

main().catch(console.error);
