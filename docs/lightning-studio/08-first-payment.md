# First Payment (Receive Your First Lightning Invoice)

Lightning payments require **inbound liquidity**. You cannot receive a Lightning payment until you have a channel with inbound capacity.

## Step 1: Check Node Status

```bash
lncli --lnddir="$LND_DIR" getinfo
```

## Step 2: Options for Inbound Liquidity

You have two common options:

1) **Open a channel** to a well-connected node.
2) **Buy inbound liquidity** from a service (e.g., a liquidity marketplace).

Without inbound liquidity, invoices will fail even if your node is running.

## Step 3: Create a Lightning Invoice

```bash
lncli --lnddir="$LND_DIR" addinvoice --amt=1000
```

This returns a payment request (invoice). Share that invoice with a payer.

## Step 4: Verify Payment

```bash
lncli --lnddir="$LND_DIR" lookupinvoice <INVOICE_HASH>
```

Look for `settled: true`.

## Optional: On-Chain Funding

To open a channel you need on-chain funds. Check your on-chain wallet:

```bash
lncli --lnddir="$LND_DIR" walletbalance
```

If you need to add funds, generate a Bitcoin address:

```bash
lncli --lnddir="$LND_DIR" newaddress p2wkh
```
