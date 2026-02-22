import { Organism } from './contracts/organism'
import { bsv, DefaultProvider } from 'scrypt-ts'
import * as fs from 'fs'
import * as path from 'path'

async function main() {
    const statePath = path.join(__dirname, '../organism-state.json')
    if (!fs.existsSync(statePath)) {
        console.log('❌ No organism-state.json found. No living organism.')
        process.exit(0)
    }

    const state = JSON.parse(fs.readFileSync(statePath, 'utf-8'))

    Organism.loadArtifact(
        JSON.parse(
            fs.readFileSync(
                path.join(__dirname, '../artifacts/organism.json'),
                'utf-8'
            )
        )
    )

    const provider = new DefaultProvider({ network: bsv.Networks.mainnet })
    await provider.connect()

    try {
        const tx = await provider.getTransaction(state.txid)
        const organism = Organism.fromTx(tx, state.outputIndex)

        const balance = organism.balance
        const reward = organism.reward
        const dustLimit = organism.dustLimit
        const generation = organism.generation
        const generationsLeft = (balance - dustLimit) / reward

        console.log('🧬 UTXO Organism Status')
        console.log('═══════════════════════')
        console.log(`  TXID:             ${state.txid}`)
        console.log(`  Output Index:     ${state.outputIndex}`)
        console.log(`  Generation:       ${generation}`)
        console.log(`  Balance:          ${balance} sats`)
        console.log(`  Reward/claim:     ${reward} sats`)
        console.log(`  Dust limit:       ${dustLimit} sats`)
        console.log(`  Generations left: ~${generationsLeft}`)
        console.log(`  Spawned:          ${state.spawnedAt}`)
        console.log(`  Explorer:         https://whatsonchain.com/tx/${state.txid}`)

        // Check if UTXO is still unspent
        const utxos = await provider.listUnspent(
            bsv.Address.fromString(state.txid) // This won't work for script hash
        )
        // We'd need to check via WoC API directly
    } catch (err: any) {
        console.error(`Error: ${err.message}`)
    }
}

main().catch(console.error)
