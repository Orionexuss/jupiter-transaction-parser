import { address, createSolanaRpc, getAddressDecoder, getArrayDecoder, getBase58Encoder, getStructDecoder, getU32Decoder, getU64Decoder, signature, } from '@solana/kit';
import { sha256 } from '@noble/hashes/sha2.js';
// Helper to compare Uint8Arrays
const arraysEqual = (a, b) => a.length === b.length && a.every((val, i) => val === b[i]);
async function main() {
    const rpc = createSolanaRpc('https://api.mainnet-beta.solana.com');
    const txId = signature('GjL1hQDphjM1kByguqgZxecwbPXk1iXQhRzem4jGXGhDPqdBEgszuRj5BVnVGQhFMt73VRygqW5F1fWMDncoF7w');
    const rpcTx = await rpc
        .getTransaction(txId, {
        commitment: 'finalized',
        encoding: 'json',
        maxSupportedTransactionVersion: 0,
    })
        .send();
    if (!rpcTx)
        throw new Error('Unable to fetch transaction');
    console.log('Tx landed at slot', rpcTx.slot);
    const JUPITER_AGGREGATOR_V6 = address('JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4');
    // Instruction discriminators for Jupiter V6
    const ROUTE_V2_IX = sha256(new TextEncoder().encode('global:route_v2')).subarray(0, 8);
    const ROUTE_IX = sha256(new TextEncoder().encode('global:route')).subarray(0, 8);
    const SHARED_ACCOUNTS_ROUTE_V2_IX = sha256(new TextEncoder().encode('global:shared_accounts_route_v2')).subarray(0, 8);
    const SHARED_ACCOUNTS_ROUTE_IX = sha256(new TextEncoder().encode('global:shared_accounts_route')).subarray(0, 8);
    const EXACT_OUT_ROUTE_V2_IX = sha256(new TextEncoder().encode('global:exact_out_route_v2')).subarray(0, 8);
    const ROUTE_WITH_TOKEN_LEDGER_IX = sha256(new TextEncoder().encode('global:route_with_token_ledger')).subarray(0, 8);
    const SHARED_ACCOUNTS_ROUTE_WITH_TOKEN_LEDGER_IX = sha256(new TextEncoder().encode('global:shared_accounts_route_with_token_ledger')).subarray(0, 8);
    const routeInstructions = [
        ['ROUTE', ROUTE_IX],
        ['ROUTE_V2', ROUTE_V2_IX],
        ['SHARED_ACCOUNTS_ROUTE', SHARED_ACCOUNTS_ROUTE_IX],
        ['SHARED_ACCOUNTS_ROUTE_V2', SHARED_ACCOUNTS_ROUTE_V2_IX],
        ['EXACT_OUT_ROUTE_V2', EXACT_OUT_ROUTE_V2_IX],
        ['ROUTE_WITH_TOKEN_LEDGER', ROUTE_WITH_TOKEN_LEDGER_IX],
        ['SHARED_ACCOUNTS_ROUTE_WITH_TOKEN_LEDGER', SHARED_ACCOUNTS_ROUTE_WITH_TOKEN_LEDGER_IX],
    ];
    let instructionFound = '';
    // Find the Jupiter swap instruction (only instructions of the Jupiter program count)
    const swapIxIdx = rpcTx.transaction.message.instructions.findIndex((ix) => {
        const program = rpcTx.transaction.message.accountKeys[ix.programIdIndex];
        if (program !== JUPITER_AGGREGATOR_V6)
            return false;
        const data = getBase58Encoder().encode(ix.data).subarray(0, 8);
        instructionFound = routeInstructions.find(([, discriminator]) => arraysEqual(data, discriminator))?.[0] ?? '';
        return Boolean(instructionFound);
    });
    if (swapIxIdx === -1)
        throw new Error('Unable to find Jupiter Swap instruction');
    // Get inner instructions associated with the Jupiter call
    const innerIxs = rpcTx.meta?.innerInstructions?.find((innerIx) => innerIx.index === swapIxIdx)?.instructions;
    if (!innerIxs)
        throw new Error('Unable to find Jupiter Swap inner instructions');
    // Event discriminators
    const SWAP_EVENT_DISCRIMINATOR = sha256(new TextEncoder().encode('event:SwapEvent')).subarray(0, 8);
    const SWAP_EVENT_DISCRIMINATOR_V2 = sha256(new TextEncoder().encode('event:SwapsEvent')).subarray(0, 8);
    // Decoders for event data
    const SwapEventDecoder = getStructDecoder([
        ['amm', getAddressDecoder()],
        ['inputMint', getAddressDecoder()],
        ['inputAmount', getU64Decoder()],
        ['outputMint', getAddressDecoder()],
        ['outputAmount', getU64Decoder()],
    ]);
    // Each SwapsEvent entry is 112 bytes on-chain: the four documented fields plus the
    // AMM program id. The published IDL omits `amm`, which misaligns every entry after the first.
    const SwapEventV2Decoder = getStructDecoder([
        ['inputMint', getAddressDecoder()],
        ['inputAmount', getU64Decoder()],
        ['outputMint', getAddressDecoder()],
        ['outputAmount', getU64Decoder()],
        ['amm', getAddressDecoder()],
    ]);
    // "SwapsEvent" (RouteV2 - multiple swaps)
    const SwapsEventDecoder = getStructDecoder([
        ['swapEvents', getArrayDecoder(SwapEventV2Decoder, { size: getU32Decoder() })],
    ]);
    // Iterate through inner instructions to find SwapEvent logs
    for (const ix of innerIxs) {
        const data = getBase58Encoder().encode(ix.data);
        const eventDiscriminator = data.subarray(8, 16);
        // Skip if event discriminator does not match SwapEvent or SwapsEvent
        const isSwapEvent = arraysEqual(eventDiscriminator, SWAP_EVENT_DISCRIMINATOR) ||
            arraysEqual(eventDiscriminator, SWAP_EVENT_DISCRIMINATOR_V2);
        if (!isSwapEvent)
            continue;
        const eventData = data.subarray(16);
        // The event discriminator, not the instruction name, decides the layout.
        if (arraysEqual(eventDiscriminator, SWAP_EVENT_DISCRIMINATOR_V2)) {
            const event = SwapsEventDecoder.decode(eventData);
            for (const swap of event.swapEvents) {
                console.log('SWAP DETECTED (V2):');
                console.log('  Input Mint:', swap.inputMint.toString());
                console.log('  Input Amount:', swap.inputAmount.toString());
                console.log('  Output Mint:', swap.outputMint.toString());
                console.log('  Output Amount:', swap.outputAmount.toString());
                console.log('  AMM:', swap.amm.toString());
            }
        }
        else {
            const event = SwapEventDecoder.decode(eventData);
            console.log('SWAP DETECTED:');
            console.log('  AMM:', event.amm.toString());
            console.log('  Input Mint:', event.inputMint.toString());
            console.log('  Input Amount:', event.inputAmount.toString());
            console.log('  Output Mint:', event.outputMint.toString());
            console.log('  Output Amount:', event.outputAmount.toString());
        }
        return; // Stop after first match
    }
    console.log('SwapEvent not found');
}
main().catch((error) => {
    console.error('Unhandled error in main', error);
    process.exit(1);
});
