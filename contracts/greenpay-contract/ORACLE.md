# CO2 Oracle Architecture

The GreenPay contract uses an on-chain oracle to provide dynamic CO2 offset pricing. This document describes the oracle implementation, update process, and future upgrade path.

## Current Implementation

The mock oracle stores a single CO2 price value that determines how grams of CO2 offset are calculated per unit of donation.

### Data Storage

CO2 price is stored in contract state under `DataKey::CO2OraclePrice` as an i128 value (in grams of CO2 per unit).

### Default Price

On contract initialization, the oracle price defaults to 100 grams of CO2 per XLM.

## Admin Update Process

Only the contract administrator can update the CO2 price:

```
call set_co2_price(admin, new_price)
  - admin: authenticated admin address
  - new_price: positive i128 value (grams CO2 per XLM)
```

The update is atomic and emits an `oracle_upd` event with the new price.

## Integration in Donation Logic

During donation processing in `record_donation`, the current oracle price is retrieved and used to calculate CO2 offset:

```
xlm_units = amount / STROOP
co2_increment = xlm_units * oracle_price
```

All donations after a price update use the new oracle value immediately.

## Future Production Integration

This mock implementation is designed for easy replacement. To integrate a real price feed:

1. Modify `set_co2_price` to fetch from external oracle (e.g., Stellar Asset Protocol)
2. Or replace it with a cached value updated by a separate off-chain service
3. The `record_donation` logic remains unchanged - it always queries the current price

The abstraction keeps the contract decoupled from any specific oracle implementation.

## Error Handling

- Price must be positive. Attempts to set zero or negative prices panic with "CO2 price must be positive".
- Invalid authenticated admins panic with "Only admin can set CO2 price".
- Uninitialized contracts default to 100 grams CO2/XLM when querying.
