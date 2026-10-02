# Feature Implementation: Referral Program, Accessibility Improvements, and Batch Donations

## Overview
This PR implements four major features and accessibility improvements for the Stellar-GreenPay platform:
- In-app donation referral program with badge XP rewards
- Accessibility improvements for donation inputs and project map
- Multi-project batch donation functionality

## Changes

### close #1305: In-app donation referral program
**Backend Changes:**
- Created database migration `010_add_referral_system.js` to add referral tracking tables and columns
- Added `referrals.js` route with endpoints for:
  - `GET /api/referrals/:publicKey` - Fetch referral stats
  - `POST /api/referrals` - Record referral relationship
  - `POST /api/referrals/award-bonus` - Award 5 XLM bonus on first donation
- Modified `donations.js` to automatically award referral bonuses when referred users make their first donation
- Updated `server.js` to register referral routes

**Frontend Changes:**
- Created `ReferralSection.tsx` component for dashboard
- Added referral stats API functions to `api.ts`
- Integrated ReferralSection into dashboard.tsx
- Referral links format: `greenpay.io/?ref=WALLETADDRESS`
- Displays referral count and bonus earned (5 XLM per successful referral)

### close #1308: Accessibility - Donation amount input aria-label
**Frontend Changes:**
- Modified `DonateForm.tsx` to add `aria-label` to donation amount input
- Added `id` attribute for label association
- Format: `aria-label="Donation amount in {currency}"`

### close #1307: Multi-project batch donation
**Smart Contract Changes:**
- Added `BatchDonation` struct to `lib.rs`
- Implemented `batch_donate()` function in GreenPay contract
- Supports up to 10 projects per batch transaction
- Atomic transaction with single signature prompt
- Properly updates donor stats, project totals, and global counters

**Frontend Changes:**
- Created `BatchDonationCart.tsx` component with:
  - Add/remove projects from cart
  - Adjust amounts per project
  - Total XLM and CO₂ offset calculation
  - Single "Donate All" button
- Cart summary shows per-project impact

### close #1310: Accessibility - ProjectMap keyboard navigation
**Frontend Changes:**
- Modified `ProjectMap.tsx` to add:
  - "View as List" toggle button
  - Keyboard-navigable list view (Arrow Up/Down, Enter/Space)
  - Row focus with visual indicator
  - tabIndex=0 on list items
  - aria-labels for accessibility
- List view displays project name, location, category, raised amount, and donor count

## Database Migration
Run the new migration to add referral tracking:
```bash
cd backend
npm run migrate
```

## Smart Contract Deployment
After deploying the updated contract, the new `batch_donate` function will be available for batch donations.

## Testing
- Referral program: Test referral link generation, tracking, and bonus awarding
- Accessibility: Verify screen readers announce donation inputs correctly
- Batch donation: Test adding multiple projects to cart and single transaction execution
- Keyboard navigation: Test list view with keyboard only (no mouse)

## Files Changed
**Backend:**
- `backend/src/db/migrations/010_add_referral_system.js` (new)
- `backend/src/routes/referrals.js` (new)
- `backend/src/routes/donations.js` (modified)
- `backend/src/server.js` (modified)

**Frontend:**
- `frontend/components/ReferralSection.tsx` (new)
- `frontend/components/BatchDonationCart.tsx` (new)
- `frontend/components/DonateForm.tsx` (modified)
- `frontend/components/ProjectMap.tsx` (modified)
- `frontend/pages/dashboard.tsx` (modified)
- `frontend/lib/api.ts` (modified)

**Contracts:**
- `contracts/greenpay-contract/src/lib.rs` (modified)
