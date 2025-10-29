import {
  address,
  createSolanaRpc,
  getAddressDecoder,
  getArrayDecoder,
  getBase58Encoder,
  getStructDecoder,
  getU32Decoder,
  getU64Decoder,
  signature,
} from '@solana/kit';
import { sha256 } from '@noble/hashes/sha2.js';

// Helper to compare Uint8Arrays
const arraysEqual = (a: Uint8Array, b: Uint8Array): boolean =>
  a.length === b.length && a.every((val, i) => val === b[i]);

async function main() {
  const rpc = createSolanaRpc('https://api.mainnet-beta.solana.com');
  const txId = signature(
    'GjL1hQDphjM1kByguqgZxecwbPXk1iXQhRzem4jGXGhDPqdBEgszuRj5BVnVGQhFMt73VRygqW5F1fWMDncoF7w'
  );

  const rpcTx = await rpc
    .getTransaction(txId, {
      commitment: 'finalized',
      encoding: 'json',
      maxSupportedTransactionVersion: 0,
    })
    .send();

  if (!rpcTx) throw new Error('Unable to fetch transaction');
  console.log('Tx landed at slot', rpcTx.slot);

  const JUPITER_AGGREGATOR_V6 = address('JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4');

  // Instruction discriminators for Jupiter V6
  const ROUTE_V2_IX = sha256(new TextEncoder().encode('global:route_v2')).subarray(0, 8);
  const ROUTE_IX = sha256(new TextEncoder().encode('global:route')).subarray(0, 8);
  const SHARED_ACCOUNTS_ROUTE_V2_IX = sha256(
    new TextEncoder().encode('global:shared_accounts_route_v2')
  ).subarray(0, 8);
  const SHARED_ACCOUNTS_ROUTE_IX = sha256(
    new TextEncoder().encode('global:shared_accounts_route')
  ).subarray(0, 8);
  const EXACT_OUT_ROUTE_V2_IX = sha256(
    new TextEncoder().encode('global:exact_out_route_v2')
  ).subarray(0, 8);

  let instructionFound = '';

  // Find the Jupiter swap instruction
  const swapIxIdx = rpcTx.transaction.message.instructions.findIndex((ix) => {
    const data = getBase58Encoder().encode(ix.data).subarray(0, 8);
    const program = rpcTx.transaction.message.accountKeys[ix.programIdIndex];

    if (arraysEqual(data, ROUTE_IX)) instructionFound = 'ROUTE';
    else if (arraysEqual(data, ROUTE_V2_IX)) instructionFound = 'ROUTE_V2';
    else if (arraysEqual(data, SHARED_ACCOUNTS_ROUTE_V2_IX))
      instructionFound = 'SHARED_ACCOUNTS_ROUTE_V2';
    else if (arraysEqual(data, SHARED_ACCOUNTS_ROUTE_IX))
      instructionFound = 'SHARED_ACCOUNTS_ROUTE';

    return program === JUPITER_AGGREGATOR_V6 && instructionFound;
  });

  if (swapIxIdx === -1) throw new Error('Unable to find Jupiter Swap instruction');

  // Get inner instructions associated with the Jupiter call
  const innerIxs = rpcTx.meta?.innerInstructions?.find(
    (innerIx) => innerIx.index === swapIxIdx
  )?.instructions;
  if (!innerIxs) throw new Error('Unable to find Jupiter Swap inner instructions');

  // Event discriminators
  const SWAP_EVENT_DISCRIMINATOR = sha256(new TextEncoder().encode('event:SwapEvent')).subarray(
    0,
    8
  );
  const SWAP_EVENT_DISCRIMINATOR_V2 = sha256(new TextEncoder().encode('event:SwapsEvent')).subarray(
    0,
    8
  );

  // Decoders for event data
  const SwapEventDecoder = getStructDecoder([
    ['amm', getAddressDecoder()],
    ['inputMint', getAddressDecoder()],
    ['inputAmount', getU64Decoder()],
    ['outputMint', getAddressDecoder()],
    ['outputAmount', getU64Decoder()],
  ]);

  const SwapEventV2Decoder = getStructDecoder([
    ['inputMint', getAddressDecoder()],
    ['inputAmount', getU64Decoder()],
    ['outputMint', getAddressDecoder()],
    ['outputAmount', getU64Decoder()],
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
    const isSwapEvent =
      arraysEqual(eventDiscriminator, SWAP_EVENT_DISCRIMINATOR) ||
      arraysEqual(eventDiscriminator, SWAP_EVENT_DISCRIMINATOR_V2);
    if (!isSwapEvent) continue;

    const eventData = data.subarray(16);

    if (
      instructionFound === 'ROUTE_V2' ||
      instructionFound === 'SHARED_ACCOUNTS_ROUTE_V2' ||
      instructionFound === 'EXACT_OUT_ROUTE_V2'
    ) {
      const event = SwapsEventDecoder.decode(eventData);

      for (const swap of event.swapEvents) {
        console.log('SWAP DETECTED (V2):');
        console.log('  Input Mint:', swap.inputMint.toString());
        console.log('  Input Amount:', swap.inputAmount.toString());
        console.log('  Output Mint:', swap.outputMint.toString());
        console.log('  Output Amount:', swap.outputAmount.toString());
      }
    } else {
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
