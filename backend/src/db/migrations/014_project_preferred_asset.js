"use strict";

/**
 * 014_project_preferred_asset
 *
 * DEX path-payment donations (#1660). A project can ask to receive a stable
 * asset (e.g. USDC) instead of XLM; donors holding another asset then pay with
 * pathPaymentStrictSend and the DEX converts in the same transaction.
 *
 *   projects.preferred_asset_code / _issuer — NULL code means native XLM (the
 *     default, so existing projects keep their current flow).
 *   donations.source_asset / source_amount — what the donor actually spent
 *     when it differs from the delivered asset. `currency` / `amount` keep
 *     meaning "what the project received", as verified on-chain.
 */
module.exports = {
  name: "014_project_preferred_asset",

  async up(client) {
    await client.query(`
      ALTER TABLE projects
        ADD COLUMN IF NOT EXISTS preferred_asset_code   TEXT,
        ADD COLUMN IF NOT EXISTS preferred_asset_issuer TEXT
    `);
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'projects_preferred_asset_chk'
        ) THEN
          ALTER TABLE projects ADD CONSTRAINT projects_preferred_asset_chk CHECK (
            (preferred_asset_code IS NULL AND preferred_asset_issuer IS NULL)
            OR (preferred_asset_code ~ '^[A-Za-z0-9]{1,12}$'
                AND preferred_asset_issuer ~ '^G[A-Z2-7]{55}$')
          );
        END IF;
      END $$
    `);
    await client.query(`
      ALTER TABLE donations
        ADD COLUMN IF NOT EXISTS source_asset  TEXT,
        ADD COLUMN IF NOT EXISTS source_amount NUMERIC(20, 7)
    `);
  },

  async down(client) {
    await client.query(`
      ALTER TABLE donations
        DROP COLUMN IF EXISTS source_amount,
        DROP COLUMN IF EXISTS source_asset
    `);
    await client.query("ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_preferred_asset_chk");
    await client.query(`
      ALTER TABLE projects
        DROP COLUMN IF EXISTS preferred_asset_issuer,
        DROP COLUMN IF EXISTS preferred_asset_code
    `);
  },
};
