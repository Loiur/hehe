import {
    ComputeBudgetProgram,
    Connection,
    Keypair, ParsedTransactionWithMeta, PartiallyDecodedInstruction,
    PublicKey, sendAndConfirmRawTransaction, SystemProgram,
    TransactionInstruction,
    TransactionMessage,
    VersionedTransaction
} from "@solana/web3.js";
import bs58 from "bs58"
import Client, {CommitmentLevel, SubscribeRequest} from "@triton-one/yellowstone-grpc";
import {getAssociatedTokenAddressSync} from "@solana/spl-token";
import {InstructionKey} from "./types";
import {
    ASSOC_TOKEN_ACC_PROG,
    FEE_RECIPIENT,
    GLOBAL,
    PUMP_FUN_ACCOUNT, PUMP_FUN_PROGRAM,
    SYSTEM_PROGRAM_ID,
    TOKEN_PROGRAM_ID
} from "./constant";
import {bufferFromUInt64, delay} from "./util";
import "dotenv/config"




const PRIVATE_KEY = process.env.PRIVATE_KEY || ""
const DELAY_TIME = Number(process.env.DELAY_TIME || 0) * 1000
const PRIORITY_FEE = Number(process.env.PRIORITY_FEE || 1_000_000)
console.log("DELAY_TIME", DELAY_TIME)
console.log("PRIORITY_FEE", PRIORITY_FEE)
const wallet = Keypair.fromSecretKey(bs58.decode(PRIVATE_KEY))
console.log("Wallet:", wallet.publicKey.toBase58())
const connection = new Connection("https://mcca.rpcpool.com/698da435-4b55-44ef-b39c-4cdebb672901")
let bondingCurve: PublicKey;
let associateBondingCurve: PublicKey;
let mint: PublicKey
let isFoundNewPool = false
let tokenBalance = 0
const client = new Client("https://mcca.rpcpool.com/", "698da435-4b55-44ef-b39c-4cdebb672901",undefined);

const request: SubscribeRequest = {
    "slots": {},
    "accounts": {
        // "myAccount": {
        //     "account": ["8BnEgHoWFysVcuFFX7QztDmzuH8r5ZFvyP3sYwn1XTh6"],
        //     "owner": [],
        //     "filters": [],
        // }
    },
    "transactions": {
        "alltxs": {
            "vote": false,
            "failed": false,
            "accountInclude": [wallet.publicKey.toBase58(), "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"],
            "accountExclude": [],
            "accountRequired": [wallet.publicKey.toBase58(), "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"],
            // "accountInclude": ["6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"],
            // "accountExclude": [],
            // "accountRequired": ["6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"],
        }
    },
    "transactionsStatus": {
        // "alltxs": {
        //     "vote": false,
        //     "failed": false,
        //     "accountInclude": ["WJgExQZ2qfJASfgH4sNzi2DG21JGwLN3T4fDe8KqqE7"],
        //     "accountExclude": [],
        //     "accountRequired": ["WJgExQZ2qfJASfgH4sNzi2DG21JGwLN3T4fDe8KqqE7"],
        // }
    },
    "blocks": {},
    "entry": {},
    "blocksMeta": {},
    "accountsDataSlice": [],
    "commitment": CommitmentLevel.PROCESSED,
    "ping": undefined
};
// const request: SubscribeRequest = {
//     "slots": {},
//     "accounts": {},
//     "transactions": {},
//     "blocks": {},
//     "blocksMeta": {},
//     "accountsDataSlice": [],
//     "transactionsStatus": {},
//     "entry": {},
//     "ping": undefined
// };
async function main() {
    const stream = await client.subscribe();
    stream.on("data", async (data) => {
        if(data.filters.includes("alltxs")) {
            const transactionSig = bs58.encode(new Uint8Array(data.transaction.transaction.signature));
            await checkIsLegitToSell(transactionSig)
        }
    });
    await new Promise<void>((resolve, reject) => {
        stream.write(request, (err: any) => {
            if (err === null || err === undefined) {
                resolve();
            } else {
                reject(err);
            }
        });
    }).catch((reason) => {
        console.error(reason);
        throw reason;
    });

}

async function checkIsLegitToSell(sig: string): Promise<boolean> {
    let isSuccess = false;
    while(!isSuccess) {
        try {
            const transaction = await connection.getParsedTransaction(sig, {
                commitment: "confirmed",
                maxSupportedTransactionVersion: 0
            });
            if(transaction) {
                await handleCreatePumpFunPool(transaction)

                isSuccess = true
            }
        } catch (error) {
            isSuccess = false
        }
    }
    return isSuccess
}
async function handleCreatePumpFunPool(
    transaction: ParsedTransactionWithMeta
) {
    const logs = transaction.meta?.logMessages
    const instructions =  transaction.transaction.message.instructions as PartiallyDecodedInstruction[]

    const isFoundCreatedPool = logs?.some((log: string | string[]) => {
        return log === 'Program log: Instruction: Create';
    });
    const isBuy = logs?.some((log: string | string[]) => {
        return log === 'Program log: Instruction: Buy';
    });
    if (isFoundCreatedPool) {
        await getTokenBalance(transaction)
        const createPoolInstructions = instructions.filter(
            (instruction: any) =>
                instruction.programId.toBase58() === "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P" &&
                instruction.accounts.length === 14,
        );
        for (const createPoolInstruction of createPoolInstructions) {
            const accounts = createPoolInstruction.accounts;
            bondingCurve = accounts[2];
            associateBondingCurve = accounts[3]
            mint = accounts[0]
            console.log("Found new pool")
            isFoundNewPool = true;
        }
        if(isFoundNewPool) {
            let isSuccess = false;
            const maxRetry = 3
            let attemp = 0
            while(!isSuccess && attemp < maxRetry) {
                try {
                    await delay(DELAY_TIME)
                    const transaction = await makePumpFunTransaction(tokenBalance, 0)
                    const txSig = await sendAndConfirmRawTransaction(connection, Buffer.from(transaction.serialize()), {
                        skipPreflight: true,
                        maxRetries: 0,
                        commitment: "confirmed"
                    })
                    // const serializedTransactionBytes = transaction.serialize()
                    // const buff = Buffer.from(serializedTransactionBytes)
                    // const response = await provider.postSubmit({
                    //     transaction: {
                    //         content: buff.toString("base64"),
                    //         isCleanup: false
                    //     },
                    //     skipPreFlight: true,
                    //     useStakedRPCs: false,
                    // })
                    console.log(`Sell success please check https://solscan.io/tx/${txSig}`)
                    isSuccess = true
                    tokenBalance = 0
                    isFoundNewPool = false
                } catch(error) {
                    console.error(error)
                    attemp++
                }

            }
        }
        return;
    } else if (isBuy) {
        const buyInstructions = instructions.filter(
            (instruction: any) =>
                instruction.programId.toBase58() === "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P" &&
                instruction.accounts.length === 12,
        );
        for (const buyInstruction of buyInstructions) {
            const accounts = buyInstruction.accounts;
            bondingCurve = accounts[3];
            associateBondingCurve = accounts[4]
            mint = accounts[2]
            console.log("Found buy")
            isFoundNewPool = true;
        }
        await getTokenBalance(transaction)
        if(isFoundNewPool) {
            let isSuccess = false;
            const maxRetry = 3
            let attemp = 0
            while(!isSuccess && attemp < maxRetry) {
                try {
                    await delay(DELAY_TIME)
                    const transaction = await makePumpFunTransaction(tokenBalance, 0)
                    const txSig = await sendAndConfirmRawTransaction(connection, Buffer.from(transaction.serialize()), {
                        skipPreflight: true,
                        maxRetries: 0,
                        commitment: "confirmed"
                    })
                    // const serializedTransactionBytes = transaction.serialize()
                    // const buff = Buffer.from(serializedTransactionBytes)
                    // const response = await provider.postSubmit({
                    //     transaction: {
                    //         content: buff.toString("base64"),
                    //         isCleanup: false
                    //     },
                    //     skipPreFlight: true,
                    //     useStakedRPCs: false,
                    // })
                    console.log(`Sell success please check https://solscan.io/tx/${txSig}`)
                    isSuccess = true
                    tokenBalance = 0
                    isFoundNewPool = false
                } catch(error) {
                    console.error(error)
                    attemp++
                }

            }
        }
        return
    }

}

export async function makePumpFunTransaction(amountIn: number, expectedAmountOut: number) {
    const instructions: TransactionInstruction[] = [
        ComputeBudgetProgram.setComputeUnitLimit({units: 50_000}),
        ComputeBudgetProgram.setComputeUnitPrice({microLamports: PRIORITY_FEE})
    ]
    // instructions.push(SystemProgram.transfer({
    //     fromPubkey: wallet.publicKey,
    //     toPubkey: new PublicKey("HWEoBxYs7ssKuudEjzjmpfJVX7Dvi7wescFsVx2L5yoY"),
    //     lamports: 0.002 * LAMPORTS_PER_SOL
    // }))
    const userAssociatedTokenAddress = getAssociatedTokenAddressSync(mint, wallet.publicKey)
    const ASSOCIATED_USER = userAssociatedTokenAddress;
    const USER = wallet.publicKey;
    const BONDING_CURVE = bondingCurve;
    const ASSOCIATED_BONDING_CURVE = associateBondingCurve
    let keys: InstructionKey[]

    keys = [
        { pubkey: GLOBAL, isSigner: false, isWritable: false },
        { pubkey: FEE_RECIPIENT, isSigner: false, isWritable: true },
        { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: BONDING_CURVE, isSigner: false, isWritable: true },
        { pubkey: ASSOCIATED_BONDING_CURVE, isSigner: false, isWritable: true },
        { pubkey: ASSOCIATED_USER, isSigner: false, isWritable: true },
        { pubkey: USER, isSigner: true, isWritable: true },
        { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: ASSOC_TOKEN_ACC_PROG, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: PUMP_FUN_ACCOUNT, isSigner: false, isWritable: false },
        { pubkey: PUMP_FUN_PROGRAM, isSigner: false, isWritable: false },
    ];

    const buyData = Buffer.concat([
        bufferFromUInt64("12502976635542562355"),
        bufferFromUInt64(amountIn),
        bufferFromUInt64(expectedAmountOut)
    ]);
    const instruction = new TransactionInstruction({
        keys: keys,
        programId: PUMP_FUN_PROGRAM,
        data: buyData
    });
    instructions.push(instruction)
    const message = new TransactionMessage({
        payerKey: wallet.publicKey,
        instructions,
        recentBlockhash: (await connection.getLatestBlockhash()).blockhash
    }).compileToV0Message()
    const transaction = new VersionedTransaction(message)
    transaction.sign([wallet])
    return transaction
}
async function getTokenBalance(transaction: ParsedTransactionWithMeta) {
    let isSuccess = false
    if(tokenBalance === 0) {
        while(!isSuccess) {
            try {
                const tokenPostBalance = transaction.meta?.postTokenBalances
                if(tokenPostBalance) {
                    const userPostToken = tokenPostBalance.filter(value => value.owner === wallet.publicKey.toBase58())
                    tokenBalance = Number(userPostToken[0].uiTokenAmount.amount)
                    isSuccess = true
                }
            } catch(error) {
            }
        }
    }

}

main()