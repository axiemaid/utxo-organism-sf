import { Organism } from './contracts/organism'
import { bsv, DefaultProvider } from 'scrypt-ts'
import * as fs from 'fs'
import * as path from 'path'
import * as https from 'https'

// ─── Configuration ───────────────────────────────────────────
const REWARD_PER_GENERATION = 1000n      // sats per claim
const FEE = 3000n                         // self-funding tx fee (~0.75 sat/byte for 4KB tx)
const DUST_LIMIT = 546n                   // BSV dust limit
const INITIAL_FUNDING = 100_000           // sats to fund the organism

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

    // Create organism instance
    const organism = new Organism(
        REWARD_PER_GENERATION,
        FEE,
        DUST_LIMIT,
        0n  // generation starts at 0
    )

    const lockingScript = organism.lockingScript

    console.log('🧬 Spawning UTXO Organism...')
    console.log(`   Reward per generation: ${REWARD_PER_GENERATION} sats`)
    console.log(`   Fee per claim: ${FEE} sats`)
    console.log(`   Dust limit: ${DUST_LIMIT} sats`)
    console.log(`   Initial funding: ${INITIAL_FUNDING} sats`)
    console.log(`   Max generations: ${(BigInt(INITIAL_FUNDING) - DUST_LIMIT) / (REWARD_PER_GENERATION + FEE)}`)

    // Fetch UTXOs for our address
    const provider = new DefaultProvider({ network: bsv.Networks.mainnet })
    await provider.connect()
    const address = privateKey.toAddress()
    console.log(`\n   Wallet: ${address.toString()}`)

    const utxos = await provider.listUnspent(address)
    const confirmed = utxos.filter((u: any) => !u.txId?.startsWith('83c1a6') && !u.txId?.startsWith('dda7b6'))
    console.log(`   UTXOs: ${confirmed.length} (${utxos.length} total, filtering stuck ones)`)

    if (confirmed.length === 0) {
        console.error('❌ No UTXOs available')
        process.exit(1)
    }

    // Build tx manually with proper fee
    const tx = new bsv.Transaction()
    let totalIn = 0
    for (const utxo of confirmed) {
        tx.from(utxo as any)
        totalIn += utxo.satoshis
        if (totalIn >= INITIAL_FUNDING + 5000) break // enough for funding + generous spawn fee
    }

    // Output 0: organism
    tx.addOutput(new bsv.Transaction.Output({
        script: lockingScript,
        satoshis: INITIAL_FUNDING,
    }))

    // Change back to wallet
    tx.change(address)
    tx.feePerKb(2000) // 2 sat/byte — generous
    tx.sign(privateKey)

    const size = tx.toBuffer().length
    const fee = tx.getFee()
    console.log(`\n   TX size: ${size} bytes`)
    console.log(`   Spawn fee: ${fee} sats (${(fee / size).toFixed(2)} sat/byte)`)

    // Broadcast via WoC
    const txhex = tx.uncheckedSerialize()
    const postData = JSON.stringify({ txhex })

    const result = await new Promise<string>((resolve, reject) => {
        const req = https.request({
            hostname: 'api.whatsonchain.com',
            path: '/v1/bsv/main/tx/raw',
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) }
        }, res => {
            let d = ''
            res.on('data', (c: any) => d += c)
            res.on('end', () => {
                if (res.statusCode !== 200) reject(new Error(`WoC ${res.statusCode}: ${d}`))
                else resolve(d)
            })
        })
        req.on('error', reject)
        req.write(postData)
        req.end()
    })

    console.log(`\n✅ Organism spawned!`)
    console.log(`   TX: ${tx.id}`)
    console.log(`   Broadcast: ${result}`)
    console.log(`   Explorer: https://whatsonchain.com/tx/${tx.id}`)

    // Save state
    const info = {
        txid: tx.id,
        outputIndex: 0,
        reward: Number(REWARD_PER_GENERATION),
        fee: Number(FEE),
        dustLimit: Number(DUST_LIMIT),
        initialFunding: INITIAL_FUNDING,
        generation: 0,
        spawnTxid: tx.id,
        spawnedAt: new Date().toISOString(),
        scriptHex: lockingScript.toHex(),
    }

    const infoPath = path.join(__dirname, '../organism-state.json')
    fs.writeFileSync(infoPath, JSON.stringify(info, null, 2))
    console.log(`📄 State saved to: ${infoPath}`)
}

main().catch(console.error)
