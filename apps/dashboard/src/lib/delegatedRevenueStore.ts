export type DelegatedRevenueRow = {
  content_id: string;
  gross_sats: number;
  provider_fee_sats: number;
  creator_net_sats: number;
  payout_status: "pending" | "paid" | "failed";
  payout_rail: "provider_custody" | "forwarded" | "creator_node" | null;
  last_updated: string;
};

const DB_NAME = "certifyd_local_runtime";
const DB_VERSION = 1;
const STORE_NAME = "delegated_revenue";

function isBrowser() {
  return typeof window !== "undefined" && typeof window.indexedDB !== "undefined";
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!isBrowser()) return reject(new Error("indexeddb_unavailable"));
    const req = window.indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "content_id" });
        store.createIndex("last_updated", "last_updated", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("indexeddb_open_failed"));
  });
}

function sanitizeRow(row: DelegatedRevenueRow): DelegatedRevenueRow {
  return {
    content_id: String(row.content_id || "").trim(),
    gross_sats: Number(row.gross_sats || 0) || 0,
    provider_fee_sats: Number(row.provider_fee_sats || 0) || 0,
    creator_net_sats: Number(row.creator_net_sats || 0) || 0,
    payout_status: row.payout_status === "paid" || row.payout_status === "failed" ? row.payout_status : "pending",
    payout_rail:
      row.payout_rail === "provider_custody" || row.payout_rail === "forwarded" || row.payout_rail === "creator_node"
        ? row.payout_rail
        : null,
    last_updated: String(row.last_updated || new Date().toISOString())
  };
}

// Upsert latest delegated revenue rows from provider authoritative snapshot.
export async function upsertDelegatedRevenue(rows: DelegatedRevenueRow[]): Promise<void> {
  if (!isBrowser()) return;
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    for (const raw of rows) {
      const row = sanitizeRow(raw);
      if (!row.content_id) continue;
      store.put(row);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error("indexeddb_upsert_failed"));
  }).finally(() => db.close());
}

// Read full persisted snapshot for offline fallback rendering.
export async function readDelegatedRevenue(): Promise<DelegatedRevenueRow[]> {
  if (!isBrowser()) return [];
  const db = await openDb();
  return new Promise<DelegatedRevenueRow[]>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const req = store.getAll();
    req.onsuccess = () => {
      const rows = Array.isArray(req.result) ? (req.result as DelegatedRevenueRow[]).map(sanitizeRow) : [];
      rows.sort((a, b) => String(b.last_updated).localeCompare(String(a.last_updated)));
      resolve(rows);
    };
    req.onerror = () => reject(req.error || new Error("indexeddb_read_failed"));
  }).finally(() => db.close());
}

