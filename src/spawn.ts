import { Organism } from './contracts/organism'
import {
    bsv,
    TestWallet,
    DefaultProvider,
    toByteString,
    MethodCallOptions,
} from 'scrypt-ts'
import * as fs from 'fs'
import * as path from 'path'

// ─── Configuration ───────────────────────────────────────────
const REWARD_PER_GENERATION = 1000n      // sats per claim
const FEE = 500n                          // self-funding tx fee
const DUST_LIMIT = 546n                   // BSV dust limit
const INITIAL_FUNDING = 100_000           // sats to fund the organism
const PROTOCOL_PREFIX = 'ORG1'

async function main() {
    // Load wallet
    const walletPath = path.join(process.env.HOME!, '.openclaw/bsv-wallet.json')
    const wallet = JSON.parse(fs.readFileSync(walletPath, 'utf-8'))
    const privateKey = bsv.PrivateKey.fromWIF(wallet.wif)

    // Load contract artifact
    Organism.loadArtifact(
        JSON.parse(
            fs.readFileSync(
                path.join(__dirname, '../artifacts/organism.json'),
                'utf-8'
            )
        )
    )

    // Set up provider and signer (mainnet)
    const provider = new DefaultProvider({ network: bsv.Networks.mainnet })
    const signer = new TestWallet(privateKey, provider)

    // Create organism instance
    const organism = new Organism(
        REWARD_PER_GENERATION,
        FEE,
        DUST_LIMIT,
        0n  // generation starts at 0
    )

    // Connect to signer
    await organism.connect(signer)

    // Deploy the organism
    console.log('🧬 Spawning UTXO Organism...')
    console.log(`   Reward per generation: ${REWARD_PER_GENERATION} sats`)
    console.log(`   Dust limit: ${DUST_LIMIT} sats`)
    console.log(`   Initial funding: ${INITIAL_FUNDING} sats`)
    console.log(`   Fee per claim: ${FEE} sats`)
    console.log(`   Max generations: ${(BigInt(INITIAL_FUNDING) - DUST_LIMIT) / (REWARD_PER_GENERATION + FEE)}`)

    // Set fee rate to 1 sat/byte to ensure mining
    ;(organism as any).feePerKb = 1000

    const deployTx = await organism.deploy(INITIAL_FUNDING)

    console.log('\n✅ Organism spawned!')
    console.log(`   TX: ${deployTx.id}`)
    console.log(`   Explorer: https://whatsonchain.com/tx/${deployTx.id}`)

    // Save organism info for the claimer
    const info = {
        txid: deployTx.id,
        outputIndex: 0,
        reward: Number(REWARD_PER_GENERATION),
        dustLimit: Number(DUST_LIMIT),
        initialFunding: INITIAL_FUNDING,
        generation: 0,
        spawnedAt: new Date().toISOString(),
        scriptHex: organism.lockingScript.toHex(),
    }

    const infoPath = path.join(__dirname, '../organism-state.json')
    fs.writeFileSync(infoPath, JSON.stringify(info, null, 2))
    console.log(`\n📄 State saved to: ${infoPath}`)
}

main().catch(console.error)
