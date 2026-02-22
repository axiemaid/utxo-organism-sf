// Claim API module — builds and broadcasts claim txs
const https = require('https');
const fs = require('fs');
const path = require('path');

const { Organism } = require('./dist/src/contracts/organism');
const { bsv, DefaultProvider, TestWallet, PubKeyHash, toByteString } = require('scrypt-ts');

const ARTIFACT_PATH = path.join(__dirname, 'artifacts/organism.json');
const STATE_PATH = path.join(__dirname, 'organism-state.json');

// Load artifact once
Organism.loadArtifact(require(ARTIFACT_PATH));

// Throwaway key just for sCrypt framework (no funds needed)
const dummyKey = bsv.PrivateKey.fromRandom('mainnet');

function wocGet(endpoint) {
  return new Promise((resolve, reject) => {
    https.get(`https://api.whatsonchain.com/v1/bsv/main${endpoint}`, {
      headers: { Accept: 'application/json' }
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error(`Bad JSON: ${data.slice(0, 200)}`)); }
      });
    }).on('error', reject);
  });
}

function wocBroadcast(txhex) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({ txhex });
    const req = https.request({
      hostname: 'api.whatsonchain.com',
      path: '/v1/bsv/main/tx/raw',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) }
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        if (res.statusCode !== 200) reject(new Error(`WoC ${res.statusCode}: ${d}`));
        else resolve(d.replace(/"/g, '').trim());
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

// Mutex to prevent double-claims
let claiming = false;

async function claim(claimerAddress) {
  if (claiming) throw new Error('Another claim is in progress, try again in a few seconds');
  claiming = true;

  try {
    // Validate address
    let addr;
    try {
      addr = new bsv.Address.fromString(claimerAddress);
    } catch {
      throw new Error('Invalid BSV address');
    }

    // Load current state
    if (!fs.existsSync(STATE_PATH)) throw new Error('Organism state not found');
    const state = JSON.parse(fs.readFileSync(STATE_PATH, 'utf-8'));

    // Compute claimer PKH from address
    const claimerPkh = toByteString(addr.hashBuffer.toString('hex'));

    // Fetch current organism tx as raw hex
    const txHex = await new Promise((resolve, reject) => {
      https.get(`https://api.whatsonchain.com/v1/bsv/main/tx/${state.txid}/hex`, res => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => resolve(data.trim()));
      }).on('error', reject);
    });
    const bsvTx = new bsv.Transaction(txHex);

    // Reconstruct organism from tx
    const provider = new DefaultProvider({ network: bsv.Networks.mainnet });
    const signer = new TestWallet(dummyKey, provider);
    await provider.connect();

    const organism = Organism.fromTx(bsvTx, state.outputIndex);
    await organism.connect(signer);

    const currentBalance = BigInt(organism.balance);
    const reward = organism.reward;
    const fee = organism.fee;
    const nextBalance = currentBalance - reward - fee;

    if (nextBalance < organism.dustLimit) {
      // Still allow the final claim — organism dies but claimer gets reward
    }

    // Build next instance
    const nextInstance = organism.next();
    nextInstance.generation = organism.generation + 1n;

    const alive = nextBalance >= organism.dustLimit;

    // Custom tx builder
    organism.bindTxBuilder('claim', (current, options, claimerPkhArg) => {
      const unsignedTx = new bsv.Transaction();
      unsignedTx.addInput(current.buildContractInput());

      if (alive) {
        unsignedTx.addOutput(new bsv.Transaction.Output({
          script: nextInstance.lockingScript,
          satoshis: Number(nextBalance),
        }));
      }

      unsignedTx.addOutput(new bsv.Transaction.Output({
        script: bsv.Script.buildPublicKeyHashOut(addr),
        satoshis: Number(reward),
      }));

      return Promise.resolve({
        tx: unsignedTx,
        atInputIndex: 0,
        nexts: alive
          ? [{ instance: nextInstance, atOutputIndex: 0, balance: Number(nextBalance) }]
          : [],
      });
    });

    const callResult = await organism.methods.claim(
      PubKeyHash(claimerPkh),
      { autoPayFee: false, partiallySigned: true, estimateFee: false }
    );

    const claimTx = callResult.tx;
    const txhex = claimTx.uncheckedSerialize();

    // Broadcast
    const txid = await wocBroadcast(txhex);

    // Update state
    if (alive) {
      state.txid = txid;
      state.outputIndex = 0;
      state.generation = Number(organism.generation) + 1;
      state.scannedAt = new Date().toISOString();
      fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
    } else {
      fs.unlinkSync(STATE_PATH);
    }

    return {
      success: true,
      txid,
      generation: Number(organism.generation + 1n),
      reward: Number(reward),
      claimer: claimerAddress,
      alive,
      balance: Number(nextBalance),
    };
  } finally {
    claiming = false;
  }
}

module.exports = { claim };
