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

## Security

The bot tracks and explains requests only. It never initiates deposits, approves withdrawals or transfers funds, and it never asks for passwords, private keys or seed phrases. Review the code, add tests and check your integrations before using it for real transactions.

## Links

- Website: [fxfunds.com](https://fxfunds.com/)
- GitHub: [FXFunds/fxfunds-deposit-withdrawal-guide](https://github.com/FXFunds/fxfunds-deposit-withdrawal-guide)
- NPM: [@fxfunds/deposit-withdrawal-guide](https://www.npmjs.com/package/@fxfunds/deposit-withdrawal-guide)
- PyPI: [fxfunds-deposit-withdrawal-guide](https://pypi.org/project/fxfunds-deposit-withdrawal-guide/)
- Quora: [fxfunds.quora.com](https://fxfunds.quora.com/)
- Pinterest: [pinterest.com/fxfunds_1](https://www.pinterest.com/fxfunds_1/)
- Medium: [medium.com/@FX_Funds](https://medium.com/@FX_Funds)
