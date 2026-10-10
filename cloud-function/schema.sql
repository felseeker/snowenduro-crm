CREATE TABLE IF NOT EXISTS crm_admin (
  id Utf8,
  email Utf8,
  password_salt Utf8,
  password_hash Utf8,
  created_at Utf8,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS crm_sessions (
  token_hash Utf8,
  expires_at Uint64,
  PRIMARY KEY (token_hash)
);

CREATE TABLE IF NOT EXISTS crm_leads (
  id Utf8,
  public_code Uint64,
  created_at Utf8,
  customer_name Utf8,
  phone Utf8,
  product_interest Utf8,
  source_page Utf8,
  compatibility_make Utf8,
  compatibility_model Utf8,
  compatibility_year Uint64,
  manager_comments Utf8,
  status Utf8,
  idempotency_key Utf8,
  consent_at Utf8,
  consent_policy_version Utf8,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS crm_idempotency (
  idempotency_key Utf8,
  lead_id Utf8,
  public_code Uint64,
  PRIMARY KEY (idempotency_key)
);

CREATE TABLE IF NOT EXISTS crm_sequences (
  name Utf8,
  value Uint64,
  PRIMARY KEY (name)
);

CREATE TABLE IF NOT EXISTS crm_products (
  id Utf8,
  slug Utf8,
  category Utf8,
  name Utf8,
  data_json Utf8,
  availability Utf8,
  is_published Bool,
  sort_order Uint64,
  updated_at Utf8,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS crm_images (
  id Utf8,
  mime_type Utf8,
  base64_data Utf8,
  created_at Utf8,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS crm_telegram_recipients (
  id Utf8,
  chat_id Utf8,
  is_enabled Bool,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS crm_notification_outbox (
  lead_id Utf8,
  state Utf8,
  attempt_count Uint64,
  last_error Utf8,
  sent_at Utf8,
  PRIMARY KEY (lead_id)
);

CREATE TABLE IF NOT EXISTS crm_catalog_publications (
  id Utf8,
  created_at Utf8,
  status Utf8,
  error_message Utf8,
  workflow_url Utf8,
  PRIMARY KEY (id)
);
