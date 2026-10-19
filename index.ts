#!/usr/bin/env node
/**
 * FXFunds Deposit and Withdrawal Guide Bot
 * Tracks deposit and withdrawal requests, validates payment details,
 * enforces a clear status flow, explains each status in plain language,
 * keeps an audit trail and reconciles requests against provider records.
 * It does not move funds, approve withdrawals or ask for passwords, keys or seed phrases.
 * Built by FXFunds — https://fxfunds.com/
 */

export type RequestType = "deposit" | "withdrawal";
export type Method = "usdt_erc20" | "usdt_trc20" | "usdt_ton" | "bank_transfer" | "card";
export type Status = "pending" | "processing" | "confirmed" | "completed" | "rejected" | "failed";
export type ReconcileResult = "matched" | "amount_mismatch" | "unmatched_request" | "unmatched_transaction" | "missing_reference";

export interface NewRequest {
  requestId: string;
  type: RequestType;
  method: Method;
  amount: number;
  currency?: string;   // default USDT for crypto methods
  address?: string;    // destination wallet (crypto) or account (bank / card withdrawals)
  reference?: string;  // bank / card / internal reference
  txHash?: string;     // on-chain hash (crypto), if already known
}

export interface HistoryEntry {
  status: Status;
  at: string;
  note: string;
}

export interface RequestRecord extends Required<Pick<NewRequest, "requestId" | "type" | "method" | "amount">> {
  currency: string;
  address: string | null;
  reference: string | null;
  txHash: string | null;
  status: Status;
  history: HistoryEntry[];
}

export interface ProviderRecord {
  txHash?: string;
  reference?: string;
  amount: number;
}

export interface ReconcileRow {
  requestId: string | null;
  key: string | null;
  result: ReconcileResult;
  detail: string;
}

export type Notifier = (record: RequestRecord, previous: Status | null) => void;

const CRYPTO: Record<string, { label: string; address: RegExp; hash: RegExp; caseInsensitive: boolean }> = {
  usdt_erc20: { label: "USDT (Ethereum ERC20)", address: /^0x[a-fA-F0-9]{40}$/, hash: /^0x[a-fA-F0-9]{64}$/, caseInsensitive: true },
  usdt_trc20: { label: "USDT (Tron TRC20)", address: /^T[1-9A-HJ-NP-Za-km-z]{33}$/, hash: /^[a-fA-F0-9]{64}$/, caseInsensitive: false },
  usdt_ton: { label: "USDT (TON)", address: /^([EU]Q[A-Za-z0-9_-]{46}|-?\d:[a-fA-F0-9]{64})$/, hash: /^([a-fA-F0-9]{64}|[A-Za-z0-9+/_-]{43}=?)$/, caseInsensitive: false },
};

export const METHODS: Record<Method, string> = {
  usdt_erc20: "USDT (Ethereum ERC20)",
  usdt_trc20: "USDT (Tron TRC20)",
  usdt_ton: "USDT (TON)",
  bank_transfer: "Bank transfer",
  card: "Card",
};

export const TRANSITIONS: Record<Status, Status[]> = {
  pending: ["processing", "rejected", "failed"],
  processing: ["confirmed", "rejected", "failed"],
  confirmed: ["completed", "failed"],
  completed: [],
  rejected: [],
  failed: [],
};

export const GUIDE: Record<RequestType, Record<Status, string>> = {
  deposit: {
    pending: "Your deposit request is recorded. Send the exact amount with the selected method and keep your transaction hash or payment reference.",
    processing: "Your deposit has been received for checking. The amount, method and reference are being matched to your request.",
    confirmed: "Your deposit has been verified against the payment record. It is waiting to be credited.",
    completed: "Your deposit is complete and has been credited.",
    rejected: "Your deposit request was rejected. Check the note for the reason and contact support with your reference if you need help.",
    failed: "Your deposit could not be processed. Check the note for the reason; do not send the payment again until the issue is resolved.",
  },
  withdrawal: {
    pending: "Your withdrawal request is recorded and waiting for review. Check that the destination address or account is correct.",
    processing: "Your withdrawal is being processed. A transaction hash or reference will be added once it is sent.",
    confirmed: "Your withdrawal has been sent and the transaction is confirmed on the network or by the provider.",
    completed: "Your withdrawal is complete.",
    rejected: "Your withdrawal request was rejected. Check the note for the reason before submitting a new request.",
    failed: "Your withdrawal could not be completed. Check the note for the reason and contact support with your request ID.",
  },
};

const isCrypto = (m: Method) => m in CRYPTO;

/** Check a new request. Returns a list of problems (empty = valid). */
export function validateRequest(req: NewRequest): string[] {
  const errors: string[] = [];
  if (!req.requestId || !req.requestId.trim()) errors.push("Request ID is required.");
  if (req.type !== "deposit" && req.type !== "withdrawal") errors.push("Type must be deposit or withdrawal.");
  if (!(req.method in METHODS)) { errors.push(`Unsupported method: ${req.method}.`); return errors; }
  if (!(typeof req.amount === "number" && isFinite(req.amount) && req.amount > 0)) errors.push("Amount must be greater than 0.");

  if (isCrypto(req.method)) {
    const net = CRYPTO[req.method];
    if (req.type === "withdrawal" && !req.address) errors.push("Destination address is required for crypto withdrawals.");
    if (req.address && !net.address.test(req.address)) errors.push(`Address format is not valid for ${net.label}.`);
    if (req.txHash && !net.hash.test(req.txHash)) errors.push(`Transaction hash format is not valid for ${net.label}.`);
  } else if (req.type === "deposit" && !req.reference) {
    errors.push(`A payment reference is required for ${METHODS[req.method]} deposits.`);
  } else if (req.type === "withdrawal" && !req.address) {
    errors.push(`A destination account is required for ${METHODS[req.method]} withdrawals.`);
  }
  return errors;
}

/** Tracks requests, enforces the status flow and keeps an audit trail. */
export class RequestTracker {
  private records = new Map<string, RequestRecord>();

  constructor(private notify?: Notifier) {}

  create(req: NewRequest, now: Date = new Date()): RequestRecord {
    const errors = validateRequest(req);
    if (this.records.has(req.requestId)) errors.push(`Request ID ${req.requestId} already exists.`);
    if (req.txHash) this.assertHashUnused(req.txHash, req.requestId, errors);
    if (errors.length) throw new Error(errors.join(" "));

    const record: RequestRecord = {
      requestId: req.requestId,
      type: req.type,
      method: req.method,
      amount: req.amount,
      currency: req.currency ?? (isCrypto(req.method) ? "USDT" : "USD"),
      address: req.address ?? null,
      reference: req.reference ?? null,
      txHash: req.txHash ?? null,
      status: "pending",
      history: [{ status: "pending", at: now.toISOString(), note: "Request recorded." }],
    };
    this.records.set(record.requestId, record);
    this.notify?.(record, null);
    return record;
  }

  update(requestId: string, status: Status, note = "", details: { txHash?: string; reference?: string } = {}, now: Date = new Date()): RequestRecord {
    const record = this.records.get(requestId);
    if (!record) throw new Error(`Unknown request ID: ${requestId}.`);
    if (!TRANSITIONS[record.status].includes(status))
      throw new Error(`Cannot move ${requestId} from ${record.status} to ${status}.`);

    const errors: string[] = [];
    if (details.txHash) {
      const net = CRYPTO[record.method];
      if (!net) errors.push("Transaction hashes only apply to crypto methods.");
      else if (!net.hash.test(details.txHash)) errors.push(`Transaction hash format is not valid for ${net.label}.`);
      this.assertHashUnused(details.txHash, requestId, errors);
    }
    if ((status === "confirmed" || status === "completed") && isCrypto(record.method) && !record.txHash && !details.txHash)
      errors.push("A transaction hash is required before a crypto request can be confirmed.");
    if ((status === "confirmed" || status === "completed") && !isCrypto(record.method) && !record.reference && !details.reference)
      errors.push("A payment reference is required before this request can be confirmed.");
    if (errors.length) throw new Error(errors.join(" "));

    const previous = record.status;
    if (details.txHash) record.txHash = details.txHash;
    if (details.reference) record.reference = details.reference;
    record.status = status;
    record.history.push({ status, at: now.toISOString(), note });
    this.notify?.(record, previous);
    return record;
  }

  get(requestId: string): RequestRecord | undefined {
    return this.records.get(requestId);
  }

  all(): RequestRecord[] {
    return [...this.records.values()];
  }

  /** Plain-language explanation of where a request stands and what happens next. */
  explain(requestId: string): string {
    const r = this.records.get(requestId);
    if (!r) throw new Error(`Unknown request ID: ${requestId}.`);
    const last = r.history[r.history.length - 1];
    const next = TRANSITIONS[r.status].length ? ` Possible next steps: ${TRANSITIONS[r.status].join(", ")}.` : "";
    const note = last.note ? ` Note: ${last.note}` : "";
    return `${r.type === "deposit" ? "Deposit" : "Withdrawal"} ${r.requestId} — ${r.amount} ${r.currency} via ${METHODS[r.method]}: ${r.status.toUpperCase()}. ${GUIDE[r.type][r.status]}${note}${next}`;
  }

  /** Compare tracked requests with records from a payment provider or blockchain source. */
  reconcile(providerRecords: ProviderRecord[]): ReconcileRow[] {
    const rows: ReconcileRow[] = [];
    const seen = new Set<string>();
    const byKey = new Map<string, RequestRecord>();
    for (const r of this.records.values()) {
      if (r.txHash) byKey.set(this.hashKey(r.method, r.txHash), r);
      if (r.reference) byKey.set(`ref:${r.reference}`, r);
    }

    for (const p of providerRecords) {
      if (!p.txHash && !p.reference) {
        rows.push({ requestId: null, key: null, result: "missing_reference", detail: `Provider record of ${p.amount} has no transaction hash or reference.` });
        continue;
      }
      const key = p.txHash ?? p.reference!;
      const match = (p.txHash && (byKey.get(`hash:${p.txHash.toLowerCase()}`) ?? byKey.get(`hash:${p.txHash}`)))
        || (p.reference && byKey.get(`ref:${p.reference}`));
      if (!match) {
        rows.push({ requestId: null, key, result: "unmatched_transaction", detail: `No request matches ${key}.` });
        continue;
      }
      seen.add(match.requestId);
      const diff = Math.round((p.amount - match.amount) * 1e6) / 1e6;
      rows.push(diff === 0
        ? { requestId: match.requestId, key, result: "matched", detail: "Amount and reference match." }
        : { requestId: match.requestId, key, result: "amount_mismatch", detail: `Provider amount ${p.amount} vs requested ${match.amount} (difference ${diff}).` });
    }

    for (const r of this.records.values()) {
      if (!seen.has(r.requestId) && (r.status === "processing" || r.status === "confirmed" || r.status === "completed"))
        rows.push({ requestId: r.requestId, key: r.txHash ?? r.reference, result: "unmatched_request", detail: `Request is ${r.status} but no provider record was found.` });
    }
    return rows;
  }

  toJSON(): string {
    return JSON.stringify(this.all(), null, 2);
  }

  toCSV(): string {
    const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
    const header = "request_id,type,method,amount,currency,status,tx_hash,reference,address,status_path";
    const rows = this.all().map((r) => [
      r.requestId, r.type, r.method, r.amount, r.currency, r.status, r.txHash ?? "", r.reference ?? "", r.address ?? "",
      esc(r.history.map((h) => h.status).join(" > ")),
    ].join(","));
    return [header, ...rows].join("\n");
  }

  private hashKey(method: Method, hash: string): string {
    return CRYPTO[method]?.caseInsensitive ? `hash:${hash.toLowerCase()}` : `hash:${hash}`;
  }

  private assertHashUnused(hash: string, requestId: string, errors: string[]): void {
    for (const r of this.records.values()) {
      if (r.requestId !== requestId && r.txHash && r.txHash.toLowerCase() === hash.toLowerCase())
        errors.push(`Duplicate: transaction hash already used by ${r.requestId}.`);
    }
  }
}

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      const key = argv[i].slice(2);
      const next = argv[i + 1];
      out[key] = next && !next.startsWith("--") ? (i++, next) : "true";
    }
  }
  return out;
}

function demo(): void {
  const t = new RequestTracker((r, prev) => console.log(`  [notify] ${r.requestId}: ${prev ?? "new"} → ${r.status}`));
  const hash = "a3f1c9e2b7d84f60c1e5a9b3d7f2e8c4a6b0d9e3f7c1a5b8e2d6f0c4a9b3e7d1";

  console.log("\nFXFunds Deposit and Withdrawal Guide Bot — demo");
  console.log("=".repeat(60));
  t.create({ requestId: "DEP-1001", type: "deposit", method: "usdt_trc20", amount: 500 });
  t.update("DEP-1001", "processing", "Incoming transfer detected.", { txHash: hash });
  t.update("DEP-1001", "confirmed", "19/19 network confirmations.");
  t.update("DEP-1001", "completed", "Credited.");

  t.create({ requestId: "WD-2001", type: "withdrawal", method: "usdt_trc20", amount: 200, address: "TXLAQ63Xg1NAzckPwKHvzw7CSEmLMEqcdj" });
  t.update("WD-2001", "processing", "Approved by operator.");

  try { t.create({ requestId: "WD-2002", type: "withdrawal", method: "usdt_erc20", amount: 50, address: "0x123" }); }
  catch (e) { console.log(`  [rejected at input] WD-2002: ${(e as Error).message}`); }
  try { t.update("DEP-1001", "processing"); }
  catch (e) { console.log(`  [blocked] ${(e as Error).message}`); }

  console.log("\nGuide:");
  console.log("  " + t.explain("WD-2001"));
  console.log("\nReconciliation:");
  for (const row of t.reconcile([{ txHash: hash, amount: 500 }, { reference: "UNKNOWN-77", amount: 20 }]))
    console.log(`  ${(row.requestId ?? "-").padEnd(9)} ${row.result.padEnd(22)} ${row.detail}`);
  console.log("\nHistory (CSV):\n" + t.toCSV());
  console.log("\nTracking only — no funds are moved. Built by FXFunds — https://fxfunds.com/\n");
}

function main(): void {
  const a = parseArgs(process.argv.slice(2));
  const type = (a.type ?? "deposit") as RequestType;

  if (a.status) {
    const s = a.status as Status;
    if (!GUIDE[type] || !GUIDE[type][s]) { console.error("Use --type deposit|withdrawal and --status pending|processing|confirmed|completed|rejected|failed"); process.exit(1); }
    console.log(`\n${type.toUpperCase()} — ${s.toUpperCase()}\n${GUIDE[type][s]}`);
    console.log(TRANSITIONS[s].length ? `Possible next steps: ${TRANSITIONS[s].join(", ")}.\n` : "This is a final status.\n");
    return;
  }

  if (a.method) {
    const req: NewRequest = {
      requestId: a.id ?? "REQUEST", type, method: a.method as Method, amount: Number(a.amount ?? 0),
      address: a.address, reference: a.reference, txHash: a.hash,
    };
    const errors = validateRequest(req);
    if (a.json) { console.log(JSON.stringify({ valid: errors.length === 0, errors }, null, 2)); return; }
    console.log(errors.length ? `\nINVALID\n${errors.map((e) => "  - " + e).join("\n")}\n` : "\nVALID — request details pass all checks.\n");
    if (errors.length) process.exitCode = 1;
    return;
  }

  demo();
}

if (require.main === module) main();
