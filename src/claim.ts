import { Organism } from './contracts/organism'
import {
    bsv,
    TestWallet,
    DefaultProvider,
    MethodCallOptions,
    PubKeyHash,
    toByteString,
    SmartContract,
} from 'scrypt-ts'
import * as fs from 'fs'
import * as path from 'path'

async function main() {
    // Load wallet (only for claimer address — no funding needed!)
    const walletPath = path.join(process.env.HOME!, '.openclaw/bsv-wallet.json')
    const wallet = JSON.parse(fs.readFileSync(walletPath, 'utf-8'))
    const privateKey = bsv.PrivateKey.fromWIF(wallet.wif)
    const claimerAddress = privateKey.toAddress()
    const claimerPkh = toByteString(
        bsv.crypto.Hash.sha256ripemd160(
            privateKey.toPublicKey().toBuffer()
        ).toString('hex')
    )

    // Load organism state
    const statePath = path.join(__dirname, '../organism-state.json')
    if (!fs.existsSync(statePath)) {
        console.error('❌ No organism-state.json found. Run spawn first.')
        process.exit(1)
    }
    const state = JSON.parse(fs.readFileSync(statePath, 'utf-8'))

    // Load contract artifact
    Organism.loadArtifact(
        JSON.parse(
            fs.readFileSync(
                path.join(__dirname, '../artifacts/organism.json'),
                'utf-8'
            )
        )
    )

    // Set up provider and signer
    const provider = new DefaultProvider({ network: bsv.Networks.mainnet })
    const signer = new TestWallet(privateKey, provider)

    console.log(`🔍 Looking for organism at ${state.txid}:${state.outputIndex}`)

    await provider.connect()
    const tx = await provider.getTransaction(state.txid)

    // Recreate the organism from state
    const organism = Organism.fromTx(tx, state.outputIndex)
    await organism.connect(signer)

    const currentBalance = BigInt(organism.balance)
    const reward = organism.reward
    const fee = organism.fee
    const nextBalance = currentBalance - reward - fee

    console.log(`\n🧬 Organism Status:`)
    console.log(`   Generation: ${organism.generation}`)
    console.log(`   Balance: ${currentBalance} sats`)
    console.log(`   Reward: ${reward} sats`)
    console.log(`   Fee: ${fee} sats`)
    console.log(`   Next balance: ${nextBalance} sats`)
    console.log(`   Claimer: ${claimerAddress.toString()}`)

    if (nextBalance < organism.dustLimit) {
        console.log('\n💀 Organism will die after this claim (below dust limit)')
    }

    // Create the next instance
    const nextInstance = organism.next()
    nextInstance.generation = organism.generation + 1n

    // Custom tx builder — organism pays for everything, no extra inputs
    organism.bindTxBuilder('claim', (
        current: Organism,
        options: MethodCallOptions<Organism>,
        claimerPkhArg: PubKeyHash
    ) => {
        const unsignedTx = new bsv.Transaction()

        // Input: the organism UTXO
        unsignedTx.addInput(current.buildContractInput())

        const alive = nextBalance >= current.dustLimit

        if (alive) {
            // Output 0: organism continues with reduced balance
            unsignedTx.addOutput(
                new bsv.Transaction.Output({
                    script: nextInstance.lockingScript,
                    satoshis: Number(nextBalance),
                })
            )
        }

        // Output 1 (or 0 if dying): reward to claimer
        unsignedTx.addOutput(
            new bsv.Transaction.Output({
                script: bsv.Script.buildPublicKeyHashOut(claimerAddress),
                satoshis: Number(reward),
            })
        )

        // Fee is implicit: input - outputs = miner fee

        return Promise.resolve({
            tx: unsignedTx,
            atInputIndex: 0,
            nexts: alive
                ? [{ instance: nextInstance, atOutputIndex: 0, balance: Number(nextBalance) }]
                : [],
        })
    })

    // Call the claim method
    console.log('\n⚡ Claiming reward (self-funded — no wallet balance needed)...')

    const callResult = await organism.methods.claim(
        PubKeyHash(claimerPkh),
        {
            autoPayFee: false,
            partiallySigned: true,
            estimateFee: false,
        } as MethodCallOptions<Organism>
    )

    const claimTx = callResult.tx

    // Broadcast manually via WoC (bypass provider fee validation)
    const https = await import('https')
    const txhex = claimTx.uncheckedSerialize()
    console.log(`   TX size: ${txhex.length / 2} bytes`)
    const postData = JSON.stringify({ txhex })

    const broadcastResult: string = await new Promise((resolve, reject) => {
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
    console.log(`   Broadcast: ${broadcastResult}`)

    console.log('\n✅ Reward claimed!')
    console.log(`   TX: ${claimTx.id}`)
    console.log(`   Explorer: https://whatsonchain.com/tx/${claimTx.id}`)
    console.log(`   Generation: ${organism.generation} → ${organism.generation + 1n}`)
    console.log(`   Reward: ${reward} sats → ${claimerAddress.toString()}`)
    console.log(`   Fee paid by organism: ${fee} sats`)

    // Update state
    if (nextBalance >= organism.dustLimit) {
        state.txid = claimTx.id
        state.outputIndex = 0
        state.generation = Number(organism.generation) + 1
        fs.writeFileSync(statePath, JSON.stringify(state, null, 2))
        console.log(`\n📄 State updated. Organism lives on!`)
        console.log(`   Remaining balance: ${nextBalance} sats`)
        console.log(
            `   Generations left: ~${(nextBalance - organism.dustLimit) / (reward + fee)}`
        )
    } else {
        fs.unlinkSync(statePath)
        console.log(`\n💀 Organism has died. State file removed.`)
    }
}

main().catch(console.error)
