/**
 * Migration 010: Add referral system
 * - Add referred_by column to profiles table
 * - Add referral_bonus_xlm column to profiles table
 * - Add referral_count column to profiles table
 * - Create referrals table to track referral relationships
 */
module.exports = {
  name: "010_add_referral_system",

  async up(client) {
    await client.query(`
      -- Add referral tracking columns to profiles
      ALTER TABLE profiles ADD COLUMN IF NOT EXISTS referred_by TEXT;
      ALTER TABLE profiles ADD COLUMN IF NOT EXISTS referral_bonus_xlm NUMERIC(20, 7) NOT NULL DEFAULT 0;
      ALTER TABLE profiles ADD COLUMN IF NOT EXISTS referral_count INTEGER NOT NULL DEFAULT 0;
      
      -- Create referrals table for tracking referral relationships
      CREATE TABLE IF NOT EXISTS referrals (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        referrer_address TEXT NOT NULL,
        referred_address TEXT NOT NULL,
        first_donation_id UUID REFERENCES donations(id),
        bonus_awarded BOOLEAN NOT NULL DEFAULT FALSE,
        bonus_xlm NUMERIC(20, 7) NOT NULL DEFAULT 5,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        first_donation_at TIMESTAMPTZ,
        UNIQUE(referrer_address, referred_address)
      );
      
      CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrer_address);
      CREATE INDEX IF NOT EXISTS idx_referrals_referred ON referrals(referred_address);
      CREATE INDEX IF NOT EXISTS idx_referrals_bonus_not_awarded ON referrals(bonus_awarded) WHERE bonus_awarded = FALSE;
    `);
  },

  async down(client) {
    await client.query("DROP TABLE IF EXISTS referrals");
    await client.query("ALTER TABLE profiles DROP COLUMN IF EXISTS referral_count");
    await client.query("ALTER TABLE profiles DROP COLUMN IF EXISTS referral_bonus_xlm");
    await client.query("ALTER TABLE profiles DROP COLUMN IF EXISTS referred_by");
  },
};
