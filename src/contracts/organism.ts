import {
    assert,
    ByteString,
    hash256,
    method,
    prop,
    PubKeyHash,
    SmartContract,
    toByteString,
    Utils,
} from 'scrypt-ts'

export class Organism extends SmartContract {
    // Reward in satoshis that the claimer receives per generation
    @prop()
    reward: bigint

    // Fixed fee deducted from organism balance (self-funding)
    @prop()
    fee: bigint

    // Dust limit - organism dies if balance falls below this
    @prop()
    dustLimit: bigint

    // Generation counter (stateful - increments each claim)
    @prop(true)
    generation: bigint

    constructor(
        reward: bigint,
        fee: bigint,
        dustLimit: bigint,
        generation: bigint
    ) {
        super(...arguments)
        this.reward = reward
        this.fee = fee
        this.dustLimit = dustLimit
        this.generation = generation
    }

    @method()
    public claim(claimerPkh: PubKeyHash) {
        // Get current balance
        const currentBalance: bigint = this.ctx.utxo.value

        // Self-funding: organism pays reward + fee from its own balance
        const nextBalance: bigint = currentBalance - this.reward - this.fee

        // Increment generation
        this.generation++

        let outputs: ByteString = toByteString('')

        if (nextBalance >= this.dustLimit) {
            // Organism survives: recreate with same script, reduced balance
            outputs = this.buildStateOutput(nextBalance)
        }
        // else: organism dies - no propagation output

        // Explicit reward output to claimer (no wallet funding needed)
        outputs += Utils.buildPublicKeyHashOutput(claimerPkh, this.reward)

        // Fee is implicit: input - organism_output - reward_output = fee to miner
        assert(
            this.ctx.hashOutputs == hash256(outputs),
            'hashOutputs mismatch'
        )
    }
}
