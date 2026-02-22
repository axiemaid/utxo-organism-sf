# UTXO Organism (Self-Funding)

A self-propagating UTXO covenant on BSV that **pays its own transaction fees**.

## What is it?

A single UTXO containing a smart contract (sCrypt) that anyone can "claim" to receive a small reward. Each claim:

1. Pays the claimer a fixed reward (1,000 sats)
2. Pays the miner fee from its own balance (500 sats)
3. Recreates itself with the remaining balance
4. Increments its generation counter

**Claimers need zero BSV.** The organism funds everything.

When the balance drops below dust limit (546 sats), the organism dies — no more propagation.

## How it works

```
Gen 0: [100,000 sats] → claim → [98,500 sats] + 1,000 to claimer + 500 to miner
Gen 1: [98,500 sats]  → claim → [97,000 sats] + 1,000 to claimer + 500 to miner
...
Gen 66: [1,000 sats]  → claim → 💀 (below dust limit)
```

The contract enforces this via `OP_PUSH_TX` — no server, no API, just script.

## Setup

```bash
npm install
npm run compile
```

## Usage

```bash
# Check current organism status
npm run status

# Claim reward (no BSV needed!)
npm run claim

# Spawn a new organism (needs funded wallet)
npm run spawn

# Scan full lineage from chain
npm run scan
```

## Configuration

In `src/spawn.ts`:
- `REWARD_PER_GENERATION` — sats paid to claimer (default: 1,000)
- `FEE` — sats paid to miner per claim (default: 500)
- `DUST_LIMIT` — minimum balance before death (default: 546)
- `INITIAL_FUNDING` — starting balance (default: 100,000)

## Architecture

- **Contract:** `src/contracts/organism.ts` — the sCrypt covenant
- **Spawn:** `src/spawn.ts` — deploy a new organism
- **Claim:** `src/claim.ts` — claim reward from living organism
- **Status:** `src/status.ts` — check organism state
- **Scanner:** `scanner.cjs` — trace full lineage from chain

## Key Innovation

Previous version required claimers to have BSV for tx fees. This version deducts the fee from the organism's own balance, making claims truly permissionless — anyone with a BSV address can participate.

## License

MIT
