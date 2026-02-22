#!/usr/bin/env node
// UTXO Organism Chain Scanner
// Traces the full lineage from spawn TX to current living organism

const https = require('https');
const fs = require('fs');
const path = require('path');

const STATE_PATH = path.join(__dirname, 'organism-state.json');
const LINEAGE_PATH = path.join(__dirname, 'lineage.json');

function wocGet(endpoint) {
  return new Promise((resolve, reject) => {
    const url = `https://api.whatsonchain.com/v1/bsv/main${endpoint}`;
    https.get(url, { headers: { 'Accept': 'application/json' } }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error(`Bad JSON from ${endpoint}: ${data.slice(0, 200)}`)); }
      });
    }).on('error', reject);
  });
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

// Extract claimer address from tx outputs (the non-organism output)
function getClaimerAddress(tx, organismOutputIndex) {
  for (let i = 0; i < tx.vout.length; i++) {
    if (i === organismOutputIndex) continue;
    const addr = tx.vout[i].scriptPubKey?.addresses?.[0];
    if (addr) return addr;
  }
  return 'unknown';
}

async function scan() {
  const state = JSON.parse(fs.readFileSync(STATE_PATH, 'utf-8'));
  const spawnTxid = state.spawnTxid || state.txid; // fallback if no spawnTxid stored

  // Try to load existing lineage to find spawn tx
  let lineage = [];
  if (fs.existsSync(LINEAGE_PATH)) {
    lineage = JSON.parse(fs.readFileSync(LINEAGE_PATH, 'utf-8'));
  }

  // Determine spawn txid — first entry in lineage or from state
  let startTxid;
  if (lineage.length > 0) {
    startTxid = lineage[0].txid;
  } else {
    // Need to find the spawn tx. Check organism-state for spawnTxid
    // or use the initial txid from when generation was 0
    startTxid = state.spawnTxid;
    if (!startTxid) {
      // If state only has current, we need user to provide spawn txid
      console.error('❌ No spawnTxid in state. Add "spawnTxid" to organism-state.json');
      process.exit(1);
    }
  }

  console.log(`🧬 Scanning organism lineage from ${startTxid.slice(0, 12)}...`);
  console.log();

  lineage = [];
  let currentTxid = startTxid;
  let generation = 0;

  while (currentTxid) {
    await delay(300); // rate limit
    const tx = await wocGet(`/tx/${currentTxid}`);

    const organismOutput = tx.vout[0]; // organism is always output 0
    const balance = Math.round(organismOutput.value * 1e8);
    const blockHeight = tx.blockheight || null;
    const blockTime = tx.blocktime ? new Date(tx.blocktime * 1000).toISOString() : null;

    // Claimer is whoever built this tx (reward goes to their address)
    const claimer = generation === 0 ? 'spawn' : getClaimerAddress(tx, 0);

    const entry = {
      generation,
      txid: currentTxid,
      balance,
      claimer,
      blockHeight,
      blockTime,
      alive: true
    };

    console.log(`  Gen ${String(generation).padStart(3)}: ${currentTxid.slice(0, 16)}... | ${String(balance).padStart(7)} sats | ${claimer === 'spawn' ? '🥚 spawn' : '⚡ ' + claimer.slice(0, 12) + '...'} | ${blockTime || 'mempool'}`);

    // Check if output 0 has been spent
    await delay(300);
    let spentInfo = null;
    try {
      // WoC: /tx/{txid}/{outputIndex}/spent
      spentInfo = await wocGet(`/tx/${currentTxid}/0/spent`);
    } catch (e) {
      // Not spent or error
    }

    if (spentInfo && spentInfo.txid) {
      entry.alive = false;
      entry.spentBy = spentInfo.txid;
      lineage.push(entry);
      currentTxid = spentInfo.txid;
      generation++;
    } else {
      // This is the living organism
      lineage.push(entry);
      currentTxid = null;
    }
  }

  // Save lineage
  fs.writeFileSync(LINEAGE_PATH, JSON.stringify(lineage, null, 2));

  const living = lineage[lineage.length - 1];
  console.log();
  console.log(`═══════════════════════════════════════════`);
  console.log(`  🧬 Organism is ALIVE at Gen ${living.generation}`);
  console.log(`  💰 Balance: ${living.balance} sats`);
  console.log(`  📊 Total claims: ${living.generation}`);
  console.log(`  📄 Lineage saved to lineage.json`);
  console.log(`═══════════════════════════════════════════`);
}

scan().catch(err => {
  console.error('❌ Scanner error:', err.message);
  process.exit(1);
});
