# FXFunds — Deposit and Withdrawal Guide Bot 🧾

[![npm version](https://img.shields.io/npm/v/@fxfunds/deposit-withdrawal-guide.svg)](https://www.npmjs.com/package/@fxfunds/deposit-withdrawal-guide)
[![PyPI version](https://img.shields.io/pypi/v/fxfunds-deposit-withdrawal-guide.svg)](https://pypi.org/project/fxfunds-deposit-withdrawal-guide/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![DOI](https://zenodo.org/badge/DOI/10.5281/zenodo.23464782.svg)](https://doi.org/10.5281/zenodo.23464782)
[![Docs](https://readthedocs.org/projects/fxfunds-deposit-withdrawal-guide/badge/?version=latest)](https://fxfunds-deposit-withdrawal-guide.readthedocs.io)

FXFunds Deposit and Withdrawal Guide Bot is a transaction workflow tool that records deposit and withdrawal requests, validates payment details, tracks each request through a clear status flow, explains every status in plain language and reconciles requests against payment provider or blockchain records. Built by [FXFunds](https://fxfunds.com/).

## Overview

Every request starts as **pending** and can only move along allowed paths: **processing**, **confirmed**, **completed**, or end as **rejected** or **failed**. Each change is written to an audit trail with a timestamp and note, and a notification callback fires on every change. A built-in guide turns any status into a clear message for the user, including what can happen next.

The bot **tracks and explains; it does not move money**. It cannot initiate deposits or approve withdrawals, and it never asks for passwords, private keys or seed phrases. A submitted request or transaction hash alone is never treated as proof of payment: crypto requests need a transaction hash, and bank or card requests need a payment reference, before they can be confirmed.

## Key Capabilities

- **Deposit Request Management** — Record amount, method, reference, timestamps and status for each deposit.
- **Withdrawal Request Tracking** — Record destination, amount and status for each withdrawal, with a full history.
- **Transaction Status Flow** — Only valid status changes are allowed (for example, a completed request cannot be reopened).
- **Stablecoin Support** — USDT on Ethereum (ERC20), Tron (TRC20) and TON, with address and transaction hash format checks.
- **Payment Detail Validation** — Required fields, supported methods, address formats and references are checked before a request is accepted.
- **Duplicate Protection** — One transaction hash cannot be attached to two requests.
- **Status Guide** — Plain-language explanation of every status for deposits and withdrawals.
- **Notifications** — A callback fires on every status change; forward it to email, Slack, Telegram or a webhook.
- **History & Audit Trail** — Every request keeps its full status path with timestamps and notes; export to JSON or CSV.
- **Reconciliation** — Compare requests with provider or blockchain records to find matches, amount mismatches, unmatched requests, unmatched transactions and records with no reference.

## How the Bot Works

| Step | What happens |
|------|--------------|
| 1. Receive | `create()` records a deposit or withdrawal request |
| 2. Validate | Method, amount, address or account, reference and hash format are checked |
| 3. Retrieve | Your code fetches updates from the payment provider or blockchain |
| 4. Track | `update()` moves the request to its next status, if the move is allowed |
| 5. Record | The audit trail stores the status, time and note |
| 6. Notify | Your callback receives every status change |
| 7. Report | `explain()`, `reconcile()` and CSV/JSON export give users and operators a clear view |

## Status Flow

```
pending ──► processing ──► confirmed ──► completed
   │             │              │
   ├──► rejected ├──► rejected  └──► failed
   └──► failed   └──► failed
```

| Status | Deposit | Withdrawal |
|--------|---------|------------|
| pending | Request recorded; send the payment and keep the reference | Request recorded; waiting for review |
| processing | Payment received for checking | Being processed |
| confirmed | Verified against the payment record | Sent and confirmed |
| completed | Credited | Complete |
| rejected | Rejected; see note | Rejected; see note |
| failed | Could not be processed; see note | Could not be completed; see note |

## Supported Methods

| Method | Key | Deposit needs | Withdrawal needs | Before confirming |
|--------|-----|---------------|------------------|-------------------|
| USDT (Ethereum ERC20) | `usdt_erc20` | — | Valid `0x…` address | Transaction hash |
| USDT (Tron TRC20) | `usdt_trc20` | — | Valid `T…` address | Transaction hash |
| USDT (TON) | `usdt_ton` | — | Valid `EQ…`/`UQ…` address | Transaction hash |
| Bank transfer | `bank_transfer` | Payment reference | Destination account | Payment reference |
| Card | `card` | Payment reference | Destination account | Payment reference |

## Quick Start

### Node.js

```bash
npm install @fxfunds/deposit-withdrawal-guide
```

```bash
# Demo
npx @fxfunds/deposit-withdrawal-guide

# Explain a status
npx @fxfunds/deposit-withdrawal-guide --type withdrawal --status processing

# Validate a request
npx @fxfunds/deposit-withdrawal-guide --type withdrawal --method usdt_trc20 --amount 200 \
  --address TXLAQ63Xg1NAzckPwKHvzw7CSEmLMEqcdj
```

```typescript
import { RequestTracker } from "@fxfunds/deposit-withdrawal-guide";

const txHash = "a3f1c9e2b7d84f60c1e5a9b3d7f2e8c4a6b0d9e3f7c1a5b8e2d6f0c4a9b3e7d1";

const tracker = new RequestTracker((record, previous) => {
  console.log(`${record.requestId}: ${previous ?? "new"} → ${record.status}`);
});

tracker.create({ requestId: "DEP-1001", type: "deposit", method: "usdt_trc20", amount: 500 });
tracker.update("DEP-1001", "processing", "Incoming transfer detected.", { txHash });
tracker.update("DEP-1001", "confirmed", "19/19 confirmations.");

console.log(tracker.explain("DEP-1001"));
console.log(tracker.reconcile([{ txHash, amount: 500 }]));
console.log(tracker.toCSV());
```

### Python

```bash
pip install fxfunds-deposit-withdrawal-guide
```

```bash
fxfunds-dw                                              # demo
fxfunds-dw --type deposit --status confirmed            # explain a status
fxfunds-dw --type deposit --method bank_transfer --amount 2000 --reference BNK-552901
# or
python -m fxfunds_deposit_withdrawal_guide --type withdrawal --status pending
```

```python
from fxfunds_deposit_withdrawal_guide import RequestTracker, NewRequest, ProviderRecord

tracker = RequestTracker(lambda r, prev: print(r.request_id, prev, "→", r.status))
tracker.create(NewRequest("WD-2001", "withdrawal", "usdt_ton", 60, address="<wallet>"))
tracker.update("WD-2001", "processing", "Approved by operator.")
tracker.update("WD-2001", "confirmed", "Sent.", tx_hash="<tx_hash>")

print(tracker.explain("WD-2001"))
print(tracker.reconcile([ProviderRecord(60, tx_hash="<tx_hash>")]))
print(tracker.to_csv())
```

### CLI Options

| Option | Description |
|--------|-------------|
| `--type` | `deposit` or `withdrawal` |
| `--status` | Explain this status (`pending`, `processing`, `confirmed`, `completed`, `rejected`, `failed`) |
| `--method` | Validate a request with this method (`usdt_erc20`, `usdt_trc20`, `usdt_ton`, `bank_transfer`, `card`) |
| `--amount` | Request amount |
| `--address` | Destination wallet or account |
| `--reference` | Payment reference |
| `--hash` | Transaction hash |
| `--json` | JSON output (validation) |

### Sample Output

```
FXFunds Deposit and Withdrawal Guide Bot — demo
============================================================
  [notify] DEP-1001: new → pending
  [notify] DEP-1001: pending → processing
  [notify] DEP-1001: processing → confirmed
  [notify] DEP-1001: confirmed → completed
  [notify] WD-2001: new → pending
  [notify] WD-2001: pending → processing
  [rejected at input] WD-2002: Address format is not valid for USDT (Ethereum ERC20).
  [blocked] Cannot move DEP-1001 from completed to processing.

Reconciliation:
  DEP-1001  matched                Amount and reference match.
  -         unmatched_transaction  No request matches UNKNOWN-77.
  WD-2001   unmatched_request      Request is processing but no provider record was found.
```

## Reconciliation Results

| Result | Meaning |
|--------|---------|
| matched | Provider record matches a request's hash or reference and amount |
| amount_mismatch | Hash or reference matches, but the amount differs |
| unmatched_request | Request is processing, confirmed or completed, but no provider record was found |
| unmatched_transaction | Provider record does not match any request |
| missing_reference | Provider record has neither a transaction hash nor a reference |

## Project Structure

```
fxfunds-deposit-withdrawal-guide/
├── index.ts                             # TypeScript bot
├── fxfunds_deposit_withdrawal_guide.py  # Python bot
├── package.json                         # NPM package config
├── package-lock.json                    # NPM lock file
├── tsconfig.json                        # TypeScript config
├── pyproject.toml                       # PyPI package config
├── setup.py                             # Legacy setup shim
├── schema.json                          # JSON-LD structured data
├── zenodo.json                          # Zenodo metadata
├── heartbeat.txt                        # Auto-updated daily
├── mkdocs.yml                           # ReadTheDocs config
├── .readthedocs.yaml                    # ReadTheDocs build config
├── docs/
│   ├── index.md                         # Documentation
│   └── requirements.txt
├── dataset/
│   └── deposit_withdrawal_benchmarks.csv
├── kaggle/
│   └── notebook.ipynb
├── .github/workflows/
│   ├── heartbeat.yml                    # Auto-commit daily
│   ├── npm-publish.yml                  # Auto-publish to NPM
│   └── pypi-publish.yml                 # Auto-publish to PyPI
├── README.md
└── LICENSE
```

## Dataset

`dataset/deposit_withdrawal_benchmarks.csv` holds 20 **synthetic deposit and withdrawal scenarios** across USDT (ERC20, TRC20, TON), bank transfer and card. They cover every status, input validation errors, a blocked duplicate hash, a blocked reopen and every reconciliation result. It is for testing and demonstration only and does not contain real transactions.

## Security and Reliability

- Tracking only: the bot never initiates deposits, approves withdrawals or transfers funds.
- It never asks for passwords, private keys or seed phrases.
- Confirmation requires a transaction hash (crypto) or payment reference (bank, card).
- One transaction hash cannot be credited to two requests.
- Every status change is recorded in an audit trail.
- Store provider API credentials in environment variables or a secrets manager, and restrict who can call `update()`.
- Review the code, add tests and check your integrations before using it for real transactions.


# FXFunds Deposits and Withdrawals FAQ

**What payment methods does FXFunds support?**  
The FXFunds website lists GPay, bank cards, Binance Pay, and USDT payment networks, including TON, Ethereum ERC-20, and Tron TRC-20.

**Does FXFunds support USDT deposits and withdrawals?**  
FXFunds lists USDT networks as payment options. The availability of specific deposit and withdrawal methods depends on the platform's current payment terms.

**How do FXFunds withdrawals work?**  
Withdrawal requests are subject to the applicable account procedures, identity verification requirements, supported payment methods, and transaction terms.

**Does FXFunds offer quick withdrawals?**  
FXFunds highlights quick withdrawals in its platform presentation. Actual processing times depend on the payment channel and applicable transaction requirements.

**Can users deposit using bank cards?**  
Bank cards appear among the payment methods listed on the FXFunds website.

## Keywords

Deposit · Withdrawal · Payment Tracking · Transaction Status · Reconciliation · USDT · Stablecoin · ERC20 · TRC20 · TON · Fintech · FXFunds

## Links

| Platform | URL |
|----------|-----|
| Website | https://fxfunds.com/ |
| GitHub | https://github.com/FXFunds/fxfunds-deposit-withdrawal-guide |
| GitHub Pages | https://fxfunds.github.io/fxfunds-deposit-withdrawal-guide/ |
| NPM | https://www.npmjs.com/package/@fxfunds/deposit-withdrawal-guide |
| PyPI | https://pypi.org/project/fxfunds-deposit-withdrawal-guide/ |
| Hugging Face | https://huggingface.co/datasets/FXFunds/deposit-withdrawal-benchmarks |
| Kaggle | https://www.kaggle.com/datasets/fxfunds/deposit-withdrawal-benchmarks |
| Zenodo | https://zenodo.org/records/23464782 |
| Docs | https://fxfunds-deposit-withdrawal-guide.readthedocs.io |
| Quora | https://fxfunds.quora.com/ |
| Pinterest | https://www.pinterest.com/fxfunds_1/ |
| Medium | https://medium.com/@FX_Funds |

## About FXFunds

FXFunds is a trading platform covering multiple financial markets, with digital payment methods including USDT on supported blockchain networks. Learn more at [fxfunds.com](https://fxfunds.com/).

## License

MIT — [FXFunds](https://fxfunds.com/)
