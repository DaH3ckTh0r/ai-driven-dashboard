import { DatabaseSync } from "node:sqlite";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS findings (
  id TEXT PRIMARY KEY,
  integration_id TEXT NOT NULL,
  monitor_id TEXT NOT NULL,
  monitor_name TEXT NOT NULL,
  kind TEXT NOT NULL,
  severity TEXT NOT NULL,
  status TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  details TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY,
  finding_id TEXT NOT NULL,
  integration_id TEXT NOT NULL,
  monitor_id TEXT NOT NULL,
  action_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL,
  requested_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  decided_by TEXT,
  decided_at TEXT,
  result TEXT
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  finding_id TEXT NOT NULL,
  role TEXT NOT NULL,
  author TEXT NOT NULL,
  text TEXT NOT NULL,
  approval_id TEXT,
  at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  actor TEXT NOT NULL,
  event TEXT NOT NULL,
  subject TEXT NOT NULL,
  detail TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_name TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS monitor_groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  owner TEXT,
  monitors TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS approvals_status ON approvals(status);
CREATE INDEX IF NOT EXISTS approvals_finding ON approvals(finding_id);
CREATE INDEX IF NOT EXISTS messages_finding ON messages(finding_id);
`;

/** Opens the database and makes sure the schema exists. */
export function openDatabase(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA foreign_keys = ON;");
  if (path !== ":memory:") db.exec("PRAGMA journal_mode = WAL;");
  db.exec(SCHEMA);
  return db;
}
