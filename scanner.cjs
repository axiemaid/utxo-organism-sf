#!/usr/bin/env node
// UTXO Organism (Self-Funding) — Chain Scanner
// Traces full lineage from spawn TX by following output 0 spends

const https = require('https');
const fs = require('fs');
const path = require('path');

const SPAWN_TXID = '83c1a61f28accc0addd3652a3bc40bfe44a7c92cd1230fa6f6692ed0e5c31c6d';
const LINEAGE_PATH = path.join(__dirname, 'lineage.json');
const STATE_PATH = path.join(__dirname, 'organism-state.json');

function wocGet(endpoint) {
  return new Promise((resolve, reject) => {
    const url = `https://api.whatsonchain.com/v1/bsv/main${endpoint}`;
    https.get(url, { headers: { Accept: 'application/json' } }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode === 404) return resolve(null);
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error(`Bad JSON from ${endpoint}: ${data.slice(0, 200)}`)); }
      });
    }).on('error', reject);
  });
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

function getRewardAddress(tx) {
  // Reward output is the last non-organism output (output 1 if alive, output 0 if dying)
  for (let i = tx.vout.length - 1; i >= 0; i--) {
    const addr = tx.vout[i].scriptPubKey?.addresses?.[0];
    if (addr) return addr;
  }
  return 'unknown';
}

async function scan() {
  console.log('🧬 UTXO Organism (Self-Funding) Scanner');
  console.log(`   Spawn: ${SPAWN_TXID.slice(0, 16)}...`);
  console.log();

  const lineage = [];
  let currentTxid = SPAWN_TXID;
  let generation = 0;

  while (currentTxid) {
    await delay(300);
    const tx = await wocGet(`/tx/${currentTxid}`);
    if (!tx) {
      console.error(`❌ Could not fetch tx ${currentTxid}`);
      break;
    }

    const isSpawn = generation === 0;
    const organismOutput = tx.vout[0];
    const balance = Math.round(organismOutput.value * 1e8);
    const blockHeight = tx.blockheight || null;
    const blockTime = tx.blocktime ? new Date(tx.blocktime * 1000).toISOString() : null;

    // For claims (gen > 0), the reward goes to a P2PKH output
    const claimer = isSpawn ? 'spawn' : getRewardAddress(tx);

    // Check how much the claimer received (reward output)
    let rewardSats = 0;
    if (!isSpawn) {
      for (let i = 1; i < tx.vout.length; i++) {
        rewardSats += Math.round(tx.vout[i].value * 1e8);
      }
    }

    // Calculate fee paid (from previous balance - current balance - reward)
    const prevBalance = generation > 0 && lineage[generation - 1]
      ? lineage[generation - 1].balance : null;
    const feePaid = prevBalance !== null ? prevBalance - balance - rewardSats : 0;

    const entry = {
      generation,
      txid: currentTxid,
      balance,
      claimer,
      reward: rewardSats,
      fee: feePaid,
      blockHeight,
      blockTime,
      alive: true,
    };

    const tag = isSpawn ? '🥚 spawn' : `⚡ ${claimer.slice(0, 16)}...`;
    const feeStr = feePaid > 0 ? ` | fee ${feePaid}` : '';
    console.log(
      `  Gen ${String(generation).padStart(3)}: ` +
      `${currentTxid.slice(0, 16)}... | ` +
      `${String(balance).padStart(7)} sats | ` +
      `${tag}` +
      (rewardSats ? ` | +${rewardSats}` : '') +
      feeStr +
      ` | ${blockTime ? blockTime.slice(0, 19) : 'mempool'}`
    );

    // Check if output 0 has been spent (organism propagated)
    await delay(300);
    let spentInfo = null;
    try {
      spentInfo = await wocGet(`/tx/${currentTxid}/0/spent`);
    } catch (e) { /* unspent */ }

    if (spentInfo && spentInfo.txid) {
      entry.alive = false;
      entry.spentBy = spentInfo.txid;
      lineage.push(entry);
      currentTxid = spentInfo.txid;
      generation++;
    } else {
      lineage.push(entry);
      currentTxid = null;
    }
  }

  // Save lineage
  fs.writeFileSync(LINEAGE_PATH, JSON.stringify(lineage, null, 2));

  // Update state file to track latest
  const living = lineage[lineage.length - 1];
  if (living.alive) {
    const state = {
      txid: living.txid,
      outputIndex: 0,
      reward: 1000,
      fee: 500,
      dustLimit: 546,
      initialFunding: 100000,
      generation: living.generation,
      spawnTxid: SPAWN_TXID,
      scannedAt: new Date().toISOString(),
    };
    fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
  }

  // Summary
  const totalClaims = lineage.filter(e => e.generation > 0).length;
  const uniqueClaimers = new Set(lineage.filter(e => e.claimer !== 'spawn').map(e => e.claimer));
  const totalRewards = lineage.reduce((sum, e) => sum + e.reward, 0);
  const totalFees = lineage.reduce((sum, e) => sum + e.fee, 0);

  console.log();
  console.log('═══════════════════════════════════════════════');
  if (living.alive) {
    const gensLeft = Math.floor((living.balance - 546) / 1500);
    console.log(`  🧬 Organism is ALIVE at Gen ${living.generation}`);
    console.log(`  💰 Balance: ${living.balance} sats`);
    console.log(`  ⏳ ~${gensLeft} generations remaining`);
  } else {
    console.log(`  💀 Organism DIED at Gen ${living.generation}`);
  }
  console.log(`  📊 Total claims: ${totalClaims}`);
  console.log(`  👥 Unique claimers: ${uniqueClaimers.size}`);
  console.log(`  💸 Total rewards: ${totalRewards} sats`);
  console.log(`  ⛏️  Total fees: ${totalFees} sats`);
  console.log(`  📄 Lineage: ${LINEAGE_PATH}`);
  console.log('═══════════════════════════════════════════════');
}

scan().catch(err => {
  console.error('❌ Scanner error:', err.message);
  process.exit(1);
});
