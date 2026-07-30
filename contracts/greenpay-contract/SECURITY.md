# Security Audit - Integer Overflow Prevention

This document records the security review of arithmetic operations in the GreenPay contract, with focus on integer overflow in global stats accumulators.

## Scope

Audit covers all arithmetic in `record_donation` and related functions that update global state:
- `GlobalTotalRaised` (i128)
- `GlobalCO2OffsetGrams` (i128)
- Project and donor statistics

## Findings

### Protected Operations

All critical arithmetic operations use Rust's checked_add to prevent silent overflow:

1. **GlobalTotalRaised updates**
   - Line 311: `gr.checked_add(amount).expect("GlobalTotalRaised overflow")`
   - Line 610: `gr.checked_add(xlm_equivalent).expect(...)`
   - Panics if sum exceeds i128::MAX (9,223,372,036,854,775,807)

2. **GlobalCO2OffsetGrams updates**
   - Line 315: `gc.checked_add(co2_increment).expect("GlobalCO2 overflow")`
   - Line 614: `gg.checked_add(co2_increment).expect(...)`
   - Panics if sum exceeds i128::MAX

3. **Pre-computation of CO2 increment**
   - Line 260: `xlm_units.checked_mul(project.co2_per_xlm as i128).expect("CO2 calculation overflow")`
   - Prevents multiplication overflow before accumulation

4. **Project and Donor statistics**
   - Line 273: Project total_raised uses checked_add
   - Line 283: Donor total_donated uses checked_add
   - Line 287: Donor co2_offset_grams uses checked_add
   - All checked operations with panic on overflow

### Extreme Input Analysis

Max donation scenarios:
- Single donation: i128::MAX stroops (9.22e18 XLM equivalent)
- With CO2 factor: 100 grams/XLM max project setting
  - Overflow would occur at: i128::MAX / 100 = 9.22e16 XLM
  - Current check prevents all overflow paths

- Multiple donations accumulating to GlobalTotalRaised:
  - Each donation checked individually before accumulation
  - Cumulative cap: i128::MAX (9.22e18 stroops total)
  - Current design prevents integer wrap-around

### Conclusion

No silent overflows possible. All operations that could exceed i128::MAX will panic with descriptive messages. The contract is safe for production use with any realistic donation volume.
