-- Stripe Connect (payees onboard as Express accounts so bounties can pay out) +
-- live-escrow fields on the hold. D1 stores only Stripe ids + booleans — never
-- card data or PII (that lives in Stripe). Non-destructive.

CREATE TABLE IF NOT EXISTS connect_accounts (
  did               TEXT PRIMARY KEY,          -- the builder/guild DID that owns this Stripe account
  account_id        TEXT NOT NULL,             -- Stripe connected account id (acct_…)
  charges_enabled   INTEGER NOT NULL DEFAULT 0,
  payouts_enabled   INTEGER NOT NULL DEFAULT 0,
  details_submitted INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Track the live Stripe PaymentIntent for an escrow hold (used when escrow runs
-- on Stripe rather than the mock).
ALTER TABLE escrow_holds ADD COLUMN payment_intent_id TEXT NOT NULL DEFAULT '';
ALTER TABLE escrow_holds ADD COLUMN provider TEXT NOT NULL DEFAULT 'mock';
