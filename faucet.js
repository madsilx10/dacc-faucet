const axios = require("axios");
require("dotenv").config();

const BASE_URL = "https://inception.dachain.io";

function loadWallets() {
  const wallets = [];
  let i = 1;
  while (process.env[`WALLET_${i}`]) {
    wallets.push(process.env[`WALLET_${i}`]);
    i++;
  }
  return wallets;
}

async function login(walletAddress) {
  const res = await axios.post(
    `${BASE_URL}/api/auth/wallet/`,
    { wallet_address: walletAddress },
    {
      headers: {
        "Content-Type": "application/json",
        "Origin": BASE_URL,
        "Referer": `${BASE_URL}/`,
      },
    }
  );

  const cookies = res.headers["set-cookie"];
  if (!cookies) throw new Error("Gagal dapat cookie!");

  const cookieStr = cookies.map(c => c.split(";")[0]).join("; ");
  const csrfMatch = cookieStr.match(/csrftoken=([^;]+)/);
  const csrf = csrfMatch ? csrfMatch[1] : "";

  return { cookieStr, csrf };
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

  console.log(`📋 Total wallet: ${wallets.length}\n`);

  for (let i = 0; i < wallets.length; i++) {
    const wallet = wallets[i];
    console.log(`[${i + 1}/${wallets.length}] Wallet: ${wallet}`);

    try {
      process.stdout.write("  🔑 Login ... ");
      const { cookieStr, csrf } = await login(wallet);
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
            claimed = true;
          } else {
            console.log(`⚠️ Status: ${res.status}, retry...`);
            await sleep(5000);
          }
        } catch (err) {
          const msg = err.response?.data?.detail || err.message;
          console.log(`❌ ${msg}`);
          if (msg.toLowerCase().includes("cooldown") || msg.toLowerCase().includes("already")) {
            console.log("  ⏰ Masih cooldown, skip.");
            claimed = true;
          } else {
            console.log("  🔄 Retry dalam 5 detik...");
            await sleep(5000);
          }
        }
      }
    } catch (err) {
      console.log(`❌ Login gagal: ${err.message}`);
    }

    if (i < wallets.length - 1) {
      console.log("  ⏳ Jeda 3 detik...\n");
      await sleep(3000);
    }
  }

  console.log("\n─────────────────────────────");
  console.log("✅ Semua wallet selesai!");
  console.log("─────────────────────────────");
}

main().catch(console.error);
