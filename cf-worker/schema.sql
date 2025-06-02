CREATE TABLE IF NOT EXISTS namespaces (
  read_key TEXT NOT NULL PRIMARY KEY,
  write_key TEXT NOT NULL,
  ip TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_namespaces_created_at ON namespaces (created_at DESC);

CREATE TABLE IF NOT EXISTS kv (
  namespace TEXT NOT NULL REFERENCES namespaces (read_key) ON DELETE CASCADE,
  key TEXT NOT NULL,
  content_type TEXT,  -- nullable
  size INTEGER NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expiration TIMESTAMP NOT NULL,
  UNIQUE (namespace, key)
);

CREATE INDEX IF NOT EXISTS idx_kv_namespace ON kv (namespace);

CREATE INDEX IF NOT EXISTS idx_kv_expiration ON kv (expiration DESC);
