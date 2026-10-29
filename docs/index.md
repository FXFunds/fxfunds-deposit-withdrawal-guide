# FXFunds Deposit and Withdrawal Guide Bot

Tracks deposit and withdrawal requests, validates payment details, explains every status and reconciles requests with provider records. Built by [FXFunds](https://fxfunds.com/). It does not move funds.

## Installation

**Node.js**

```bash
npm install @fxfunds/deposit-withdrawal-guide
```

**Python**

```bash
pip install fxfunds-deposit-withdrawal-guide
fxfunds-dw
```

## Usage

```bash
# Demo
fxfunds-dw

# Explain a status
fxfunds-dw --type withdrawal --status processing

# Validate a request
fxfunds-dw --type withdrawal --method usdt_trc20 --amount 200 --address <wallet> [--json]
```

| Option | Description |
|--------|-------------|
| `--type` | `deposit` or `withdrawal` |
| `--status` | Explain this status |
| `--method` | Validate a request with this method |
| `--amount` | Request amount |
| `--address` | Destination wallet or account |
| `--reference` | Payment reference |
| `--hash` | Transaction hash |
| `--json` | JSON output (validation) |

## API

### `validateRequest(request)`

Returns a list of problems with a new request (empty list = valid). Python: `validate_request()`.

### `RequestTracker(notify?)`

- `create(request)` — validates and records a request as **pending**
- `update(requestId, status, note, details?)` — moves the request to an allowed status; `details` can add a `txHash` or `reference`
- `explain(requestId)` — plain-language status message with possible next steps
- `reconcile(providerRecords)` — compares requests with provider or blockchain records
- `get(requestId)` / `all()` — read records
- `toJSON()` / `toCSV()` — export (Python: `to_json()` / `to_csv()`)
- `notify(record, previousStatus)` — optional callback on every change

### `TRANSITIONS`, `GUIDE`, `METHODS`

The allowed status moves, the guide text for each status, and the supported methods.

## Status Flow

| From | Allowed next |
|------|--------------|
| pending | processing, rejected, failed |
| processing | confirmed, rejected, failed |
| confirmed | completed, failed |
| completed | — (final) |
| rejected | — (final) |
| failed | — (final) |

## Validation Rules

| Method | Deposit needs | Withdrawal needs | Before confirming |
|--------|---------------|------------------|-------------------|
| `usdt_erc20` / `usdt_trc20` / `usdt_ton` | — | Valid wallet address | Transaction hash |
| `bank_transfer` / `card` | Payment reference | Destination account | Payment reference |

All requests need a unique request ID and an amount greater than 0. A transaction hash cannot be used by two requests.

## Reconciliation Results

| Result | Meaning |
|--------|---------|
| matched | Hash or reference and amount match |
| amount_mismatch | Hash or reference matches; amount differs |
| unmatched_request | Request is processing, confirmed or completed with no provider record |
| unmatched_transaction | Provider record matches no request |
| missing_reference | Provider record has no hash or reference |

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

## Links

- Website: [fxfunds.com](https://fxfunds.com/)
- GitHub: [FXFunds/fxfunds-deposit-withdrawal-guide](https://github.com/FXFunds/fxfunds-deposit-withdrawal-guide)
- NPM: [@fxfunds/deposit-withdrawal-guide](https://www.npmjs.com/package/@fxfunds/deposit-withdrawal-guide)
- PyPI: [fxfunds-deposit-withdrawal-guide](https://pypi.org/project/fxfunds-deposit-withdrawal-guide/)
- Quora: [fxfunds.quora.com](https://fxfunds.quora.com/)
- Pinterest: [pinterest.com/fxfunds_1](https://www.pinterest.com/fxfunds_1/)
- Medium: [medium.com/@FX_Funds](https://medium.com/@FX_Funds)
