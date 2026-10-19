#!/usr/bin/env python3
"""
FXFunds Deposit and Withdrawal Guide Bot (Python)
Tracks deposit and withdrawal requests, validates payment details,
enforces a clear status flow, explains each status in plain language,
keeps an audit trail and reconciles requests against provider records.
It does not move funds, approve withdrawals or ask for passwords, keys or seed phrases.
Built by FXFunds — https://fxfunds.com/
"""

__version__ = "1.0.0"

import argparse
import csv
import io
import json
import re
import sys
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from typing import Callable, Dict, List, Optional

CRYPTO: Dict[str, dict] = {
    "usdt_erc20": {"label": "USDT (Ethereum ERC20)", "address": re.compile(r"^0x[a-fA-F0-9]{40}$"),
                   "hash": re.compile(r"^0x[a-fA-F0-9]{64}$"), "case_insensitive": True},
    "usdt_trc20": {"label": "USDT (Tron TRC20)", "address": re.compile(r"^T[1-9A-HJ-NP-Za-km-z]{33}$"),
                   "hash": re.compile(r"^[a-fA-F0-9]{64}$"), "case_insensitive": False},
    "usdt_ton": {"label": "USDT (TON)", "address": re.compile(r"^([EU]Q[A-Za-z0-9_-]{46}|-?\d:[a-fA-F0-9]{64})$"),
                 "hash": re.compile(r"^([a-fA-F0-9]{64}|[A-Za-z0-9+/_-]{43}=?)$"), "case_insensitive": False},
}

METHODS: Dict[str, str] = {
    "usdt_erc20": "USDT (Ethereum ERC20)",
    "usdt_trc20": "USDT (Tron TRC20)",
    "usdt_ton": "USDT (TON)",
    "bank_transfer": "Bank transfer",
    "card": "Card",
}

TRANSITIONS: Dict[str, List[str]] = {
    "pending": ["processing", "rejected", "failed"],
    "processing": ["confirmed", "rejected", "failed"],
    "confirmed": ["completed", "failed"],
    "completed": [],
    "rejected": [],
    "failed": [],
}

GUIDE: Dict[str, Dict[str, str]] = {
    "deposit": {
        "pending": "Your deposit request is recorded. Send the exact amount with the selected method and keep your transaction hash or payment reference.",
        "processing": "Your deposit has been received for checking. The amount, method and reference are being matched to your request.",
        "confirmed": "Your deposit has been verified against the payment record. It is waiting to be credited.",
        "completed": "Your deposit is complete and has been credited.",
        "rejected": "Your deposit request was rejected. Check the note for the reason and contact support with your reference if you need help.",
        "failed": "Your deposit could not be processed. Check the note for the reason; do not send the payment again until the issue is resolved.",
    },
    "withdrawal": {
        "pending": "Your withdrawal request is recorded and waiting for review. Check that the destination address or account is correct.",
        "processing": "Your withdrawal is being processed. A transaction hash or reference will be added once it is sent.",
        "confirmed": "Your withdrawal has been sent and the transaction is confirmed on the network or by the provider.",
        "completed": "Your withdrawal is complete.",
        "rejected": "Your withdrawal request was rejected. Check the note for the reason before submitting a new request.",
        "failed": "Your withdrawal could not be completed. Check the note for the reason and contact support with your request ID.",
    },
}


def _is_crypto(method: str) -> bool:
    return method in CRYPTO


def _now(now: Optional[datetime]) -> str:
    return (now or datetime.now(timezone.utc)).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def _num(n: float) -> str:
    n = round(n, 6)
    return str(int(n)) if n == int(n) else str(n)


@dataclass
class NewRequest:
    request_id: str
    type: str
    method: str
    amount: float
    currency: Optional[str] = None
    address: Optional[str] = None
    reference: Optional[str] = None
    tx_hash: Optional[str] = None


@dataclass
class HistoryEntry:
    status: str
    at: str
    note: str


@dataclass
class RequestRecord:
    request_id: str
    type: str
    method: str
    amount: float
    currency: str
    address: Optional[str]
    reference: Optional[str]
    tx_hash: Optional[str]
    status: str
    history: List[HistoryEntry] = field(default_factory=list)


@dataclass
class ProviderRecord:
    amount: float
    tx_hash: Optional[str] = None
    reference: Optional[str] = None


@dataclass
class ReconcileRow:
    request_id: Optional[str]
    key: Optional[str]
    result: str
    detail: str


Notifier = Callable[[RequestRecord, Optional[str]], None]


def validate_request(req: NewRequest) -> List[str]:
    """Check a new request. Returns a list of problems (empty = valid)."""
    errors: List[str] = []
    if not req.request_id or not req.request_id.strip():
        errors.append("Request ID is required.")
    if req.type not in ("deposit", "withdrawal"):
        errors.append("Type must be deposit or withdrawal.")
    if req.method not in METHODS:
        errors.append(f"Unsupported method: {req.method}.")
        return errors
    if not (isinstance(req.amount, (int, float)) and req.amount == req.amount and req.amount > 0 and req.amount != float("inf")):
        errors.append("Amount must be greater than 0.")

    if _is_crypto(req.method):
        net = CRYPTO[req.method]
        if req.type == "withdrawal" and not req.address:
            errors.append("Destination address is required for crypto withdrawals.")
        if req.address and not net["address"].match(req.address):
            errors.append(f"Address format is not valid for {net['label']}.")
        if req.tx_hash and not net["hash"].match(req.tx_hash):
            errors.append(f"Transaction hash format is not valid for {net['label']}.")
    elif req.type == "deposit" and not req.reference:
        errors.append(f"A payment reference is required for {METHODS[req.method]} deposits.")
    elif req.type == "withdrawal" and not req.address:
        errors.append(f"A destination account is required for {METHODS[req.method]} withdrawals.")
    return errors


class RequestTracker:
    """Tracks requests, enforces the status flow and keeps an audit trail."""

    def __init__(self, notify: Optional[Notifier] = None):
        self._records: Dict[str, RequestRecord] = {}
        self._notify = notify

    def create(self, req: NewRequest, now: Optional[datetime] = None) -> RequestRecord:
        errors = validate_request(req)
        if req.request_id in self._records:
            errors.append(f"Request ID {req.request_id} already exists.")
        if req.tx_hash:
            self._assert_hash_unused(req.tx_hash, req.request_id, errors)
        if errors:
            raise ValueError(" ".join(errors))

        record = RequestRecord(
            request_id=req.request_id, type=req.type, method=req.method, amount=req.amount,
            currency=req.currency or ("USDT" if _is_crypto(req.method) else "USD"),
            address=req.address, reference=req.reference, tx_hash=req.tx_hash, status="pending",
            history=[HistoryEntry("pending", _now(now), "Request recorded.")],
        )
        self._records[record.request_id] = record
        if self._notify:
            self._notify(record, None)
        return record

    def update(self, request_id: str, status: str, note: str = "", tx_hash: Optional[str] = None,
               reference: Optional[str] = None, now: Optional[datetime] = None) -> RequestRecord:
        record = self._records.get(request_id)
        if record is None:
            raise KeyError(f"Unknown request ID: {request_id}.")
        if status not in TRANSITIONS[record.status]:
            raise ValueError(f"Cannot move {request_id} from {record.status} to {status}.")

        errors: List[str] = []
        if tx_hash:
            net = CRYPTO.get(record.method)
            if net is None:
                errors.append("Transaction hashes only apply to crypto methods.")
            elif not net["hash"].match(tx_hash):
                errors.append(f"Transaction hash format is not valid for {net['label']}.")
            self._assert_hash_unused(tx_hash, request_id, errors)
        if status in ("confirmed", "completed") and _is_crypto(record.method) and not record.tx_hash and not tx_hash:
            errors.append("A transaction hash is required before a crypto request can be confirmed.")
        if status in ("confirmed", "completed") and not _is_crypto(record.method) and not record.reference and not reference:
            errors.append("A payment reference is required before this request can be confirmed.")
        if errors:
            raise ValueError(" ".join(errors))

        previous = record.status
        if tx_hash:
            record.tx_hash = tx_hash
        if reference:
            record.reference = reference
        record.status = status
        record.history.append(HistoryEntry(status, _now(now), note))
        if self._notify:
            self._notify(record, previous)
        return record

    def get(self, request_id: str) -> Optional[RequestRecord]:
        return self._records.get(request_id)

    def all(self) -> List[RequestRecord]:
        return list(self._records.values())

    def explain(self, request_id: str) -> str:
        """Plain-language explanation of where a request stands and what happens next."""
        r = self._records.get(request_id)
        if r is None:
            raise KeyError(f"Unknown request ID: {request_id}.")
        last = r.history[-1]
        nxt = f" Possible next steps: {', '.join(TRANSITIONS[r.status])}." if TRANSITIONS[r.status] else ""
        note = f" Note: {last.note}" if last.note else ""
        kind = "Deposit" if r.type == "deposit" else "Withdrawal"
        return (f"{kind} {r.request_id} — {_num(r.amount)} {r.currency} via {METHODS[r.method]}: "
                f"{r.status.upper()}. {GUIDE[r.type][r.status]}{note}{nxt}")

    def reconcile(self, provider_records: List[ProviderRecord]) -> List[ReconcileRow]:
        """Compare tracked requests with records from a payment provider or blockchain source."""
        rows: List[ReconcileRow] = []
        seen = set()
        by_key: Dict[str, RequestRecord] = {}
        for r in self._records.values():
            if r.tx_hash:
                by_key[self._hash_key(r.method, r.tx_hash)] = r
            if r.reference:
                by_key[f"ref:{r.reference}"] = r

        for p in provider_records:
            if not p.tx_hash and not p.reference:
                rows.append(ReconcileRow(None, None, "missing_reference",
                                         f"Provider record of {_num(p.amount)} has no transaction hash or reference."))
                continue
            key = p.tx_hash or p.reference
            match = None
            if p.tx_hash:
                match = by_key.get(f"hash:{p.tx_hash.lower()}") or by_key.get(f"hash:{p.tx_hash}")
            if match is None and p.reference:
                match = by_key.get(f"ref:{p.reference}")
            if match is None:
                rows.append(ReconcileRow(None, key, "unmatched_transaction", f"No request matches {key}."))
                continue
            seen.add(match.request_id)
            diff = round(p.amount - match.amount, 6)
            if diff == 0:
                rows.append(ReconcileRow(match.request_id, key, "matched", "Amount and reference match."))
            else:
                rows.append(ReconcileRow(match.request_id, key, "amount_mismatch",
                                         f"Provider amount {_num(p.amount)} vs requested {_num(match.amount)} (difference {_num(diff)})."))

        for r in self._records.values():
            if r.request_id not in seen and r.status in ("processing", "confirmed", "completed"):
                rows.append(ReconcileRow(r.request_id, r.tx_hash or r.reference, "unmatched_request",
                                         f"Request is {r.status} but no provider record was found."))
        return rows

    def to_json(self) -> str:
        return json.dumps([asdict(r) for r in self.all()], indent=2)

    def to_csv(self) -> str:
        buf = io.StringIO()
        w = csv.writer(buf, lineterminator="\n")
        w.writerow(["request_id", "type", "method", "amount", "currency", "status", "tx_hash", "reference", "address", "status_path"])
        for r in self.all():
            w.writerow([r.request_id, r.type, r.method, _num(r.amount), r.currency, r.status, r.tx_hash or "",
                        r.reference or "", r.address or "", " > ".join(h.status for h in r.history)])
        return buf.getvalue().rstrip("\n")

    @staticmethod
    def _hash_key(method: str, tx_hash: str) -> str:
        net = CRYPTO.get(method)
        return f"hash:{tx_hash.lower()}" if net and net["case_insensitive"] else f"hash:{tx_hash}"

    def _assert_hash_unused(self, tx_hash: str, request_id: str, errors: List[str]) -> None:
        for r in self._records.values():
            if r.request_id != request_id and r.tx_hash and r.tx_hash.lower() == tx_hash.lower():
                errors.append(f"Duplicate: transaction hash already used by {r.request_id}.")


def demo() -> None:
    t = RequestTracker(lambda r, prev: print(f"  [notify] {r.request_id}: {prev or 'new'} → {r.status}"))
    tx_hash = "a3f1c9e2b7d84f60c1e5a9b3d7f2e8c4a6b0d9e3f7c1a5b8e2d6f0c4a9b3e7d1"

    print("\nFXFunds Deposit and Withdrawal Guide Bot — demo")
    print("=" * 60)
    t.create(NewRequest("DEP-1001", "deposit", "usdt_trc20", 500))
    t.update("DEP-1001", "processing", "Incoming transfer detected.", tx_hash=tx_hash)
    t.update("DEP-1001", "confirmed", "19/19 network confirmations.")
    t.update("DEP-1001", "completed", "Credited.")

    t.create(NewRequest("WD-2001", "withdrawal", "usdt_trc20", 200, address="TXLAQ63Xg1NAzckPwKHvzw7CSEmLMEqcdj"))
    t.update("WD-2001", "processing", "Approved by operator.")

    try:
        t.create(NewRequest("WD-2002", "withdrawal", "usdt_erc20", 50, address="0x123"))
    except ValueError as e:
        print(f"  [rejected at input] WD-2002: {e}")
    try:
        t.update("DEP-1001", "processing")
    except ValueError as e:
        print(f"  [blocked] {e}")

    print("\nGuide:")
    print("  " + t.explain("WD-2001"))
    print("\nReconciliation:")
    for row in t.reconcile([ProviderRecord(500, tx_hash=tx_hash), ProviderRecord(20, reference="UNKNOWN-77")]):
        print(f"  {(row.request_id or '-'):<9} {row.result:<22} {row.detail}")
    print("\nHistory (CSV):\n" + t.to_csv())
    print("\nTracking only — no funds are moved. Built by FXFunds — https://fxfunds.com/\n")


def main() -> None:
    p = argparse.ArgumentParser(description="FXFunds Deposit and Withdrawal Guide Bot")
    p.add_argument("--type", default="deposit", choices=["deposit", "withdrawal"])
    p.add_argument("--status", choices=list(TRANSITIONS.keys()), help="Explain a status")
    p.add_argument("--method", choices=list(METHODS.keys()), help="Validate a request with this method")
    p.add_argument("--id", default="REQUEST")
    p.add_argument("--amount", type=float, default=0)
    p.add_argument("--address")
    p.add_argument("--reference")
    p.add_argument("--hash")
    p.add_argument("--json", action="store_true")
    a = p.parse_args()

    if a.status:
        print(f"\n{a.type.upper()} — {a.status.upper()}\n{GUIDE[a.type][a.status]}")
        nxt = TRANSITIONS[a.status]
        print(f"Possible next steps: {', '.join(nxt)}.\n" if nxt else "This is a final status.\n")
        return

    if a.method:
        errors = validate_request(NewRequest(a.id, a.type, a.method, a.amount, address=a.address,
                                             reference=a.reference, tx_hash=a.hash))
        if a.json:
            print(json.dumps({"valid": not errors, "errors": errors}, indent=2))
            return
        if errors:
            print("\nINVALID\n" + "\n".join(f"  - {e}" for e in errors) + "\n")
            sys.exit(1)
        print("\nVALID — request details pass all checks.\n")
        return

    demo()


if __name__ == "__main__":
    main()
