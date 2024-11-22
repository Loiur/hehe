export function bufferFromUInt64(value: number | string | bigint) {
    let buffer = Buffer.alloc(8);
    buffer.writeBigUInt64LE(BigInt(value));
    return buffer;
}

export async function delay(sec: number) {
    return await new Promise((resolve) => setTimeout(resolve, sec))
}