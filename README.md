# Jupiter Transaction Parser

A TypeScript tool for parsing Jupiter DEX swap transactions on Solana and extracting detailed swap information.

## What it does

- Fetches Solana transactions by signature
- Identifies Jupiter V6 swap instructions (`route` and `route_v2`)
- Extracts swap event data including input/output tokens and amounts
- Supports both single swaps and multi-hop swaps

## Quick Start

```bash
npm install
npm run start
```

## Example Output

```
SWAP DETECTED (V2):
  Input Mint: So11111111111111111111111111111111111111112
  Input Amount: 1000000000
  Output Mint: EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v
  Output Amount: 5000000000
```

## Dependencies

- `@solana/kit` - Solana RPC client and encoding utilities
- `@noble/hashes` - Cryptographic hashing for instruction discriminators

## How it works

1. Connects to Solana mainnet RPC
2. Fetches transaction by signature
3. Searches for Jupiter program instructions
4. Decodes inner instruction logs to extract swap events
5. Parses swap data using struct decoders

Perfect for analyzing Jupiter swap transactions and building trading analytics.
