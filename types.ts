import {PublicKey} from "@solana/web3.js";

export type InstructionKey = {
    pubkey: PublicKey,
    isSigner: boolean,
    isWritable: boolean
}