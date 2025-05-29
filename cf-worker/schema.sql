CREATE TABLE IF NOT EXISTS namespaces (
  id TEXT NOT NULL PRIMARY KEY,
  ip TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_namespaces_ip ON namespaces (ip);

CREATE INDEX IF NOT EXISTS idx_namespaces_created_at ON namespaces (created_at DESC);

CREATE TABLE IF NOT EXISTS kv (
  namespace_id TEXT NOT NULL REFERENCES namespaces (id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  content_type TEXT,  -- nullable
  size INTEGER NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expiration TIMESTAMP NOT NULL,
  UNIQUE (namespace_id, key)
);

CREATE INDEX IF NOT EXISTS idx_kv_namespace_id ON kv (namespace_id);

CREATE INDEX IF NOT EXISTS idx_kv_expiration ON kv (expiration DESC);
