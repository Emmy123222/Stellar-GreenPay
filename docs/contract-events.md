# Contract Events

## `DonateEvent`

The `donate` event is emitted after a successful XLM donation and token
transfer. Its topic is `("donate",)` and its data is the following Soroban
contract type:

```rust
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DonateEvent {
    pub donor: Address,
    pub project_id: String,
    pub amount: i128,
    pub co2_offset: i128,
    pub timestamp: u64,
}
```

`amount` is denominated in stroops. `co2_offset` is the calculated CO2 offset
in grams, and `timestamp` is the ledger timestamp in seconds. The existing
`donated` event remains available for consumers of the legacy topic and
payload.