# GreenPay Contract Upgrade Notes

## Storage Compatibility

GreenPay uses Soroban instance storage. Upgrade code must keep existing storage keys and stored value layouts backward-compatible because old ledger entries are decoded by the new contract executable after upgrade.

The current persisted keys are:

- `DataKey::Admin`
- `DataKey::Project(String)`
- `DataKey::ProjectCount`
- `DataKey::DonorStats(Address)`
- `DataKey::ImpactNFT(Address, BadgeTier)`
- `DataKey::DonationCount`
- `DataKey::GlobalTotalRaised`
- `DataKey::GlobalCO2OffsetGrams`
- `DataKey::HasDonated(String, Address)`
- `DataKey::Proposal(String)`
- `DataKey::HasVoted(String, Address)`

Do not rename or remove these variants, change their argument order, or reorder/remove fields from stored structs such as `Project`, `DonorStats`, `ImpactNFT`, or `VoteProposal` without adding an explicit migration path. New fields should be handled through a new storage version or a new key namespace so existing v1 values remain decodable.

## Regression Coverage

`test_upgrade_preserves_donation_state_and_storage_keys` covers the v1 to v2 same-code path:

1. Deploys GreenPay v1 in the Soroban test host.
2. Registers a project and records a real token-backed donation.
3. Replaces the executable at the same contract ID with the same GreenPay code to model a v2 upgrade.
4. Reads the donation-derived project totals, donor stats, badge/NFT state, global counters, and `HasDonated` marker through both public getters and direct `DataKey` lookups.

This confirms the storage keys and value layouts used by existing donation state remain backward-compatible across the upgrade.

## Validation

Run the focused regression test:

```bash
cargo test -p greenpay-contract --lib test_upgrade_preserves_donation_state_and_storage_keys
```

Run the full contract suite:

```bash
cargo test
```
