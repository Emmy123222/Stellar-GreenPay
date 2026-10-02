# USDC to XLM Oracle

`donate_usdc` reads the current USDC/XLM conversion rate from an on-chain
oracle for every donation. There is no fallback exchange rate in the contract.

## Chosen Oracle

GreenPay uses the public
[Reflector Pulse](https://github.com/reflector-network/reflector-contract)
contract interface. Reflector Pulse is an on-chain Stellar oracle compatible
with SEP-40. Production deployments must select a Pulse feed whose base asset
is XLM and which contains the configured Stellar USDC asset.

GreenPay calls these SEP-40 methods:

```rust
fn decimals() -> u32;
fn lastprice(asset: OracleAsset) -> Option<OraclePriceData>;
fn resolution() -> u32;
```

`lastprice` receives `OracleAsset::Stellar(usdc_token)`. Its price is XLM per
USDC encoded with the precision returned by `decimals`. For example, a price
of `2.5` with six decimals is returned as `2_500_000`.

GreenPay also checks the quote timestamp. A quote is rejected if it is in the
future or older than three times the oracle's advertised update resolution.
Missing prices, non-positive prices, zero resolutions, and unsupported decimal
scales also fail the donation.

## Configuration

The administrator configures both addresses atomically:

```text
set_usdc_token(admin, usdc_token, oracle_address)
```

This stores `USDCTokenAddress` and `OracleAddress` in one authenticated call,
so `donate_usdc` cannot observe a token configured without its price oracle.

The configured addresses are available through:

```text
get_usdc_token()
get_oracle()
```

The `MockOracle` in `src/lib.rs` implements the same SEP-40 subset for local
tests. It returns `8 XLM/USDC` and must not be used in production.

## Conversion

For a USDC amount `A` in six-decimal base units, oracle price `P`, and oracle
decimals `D`, the XLM-equivalent amount in stroops is:

```text
xlm_equivalent = (A * P * 10_000_000) / (1_000_000 * (10 ^ D))
```

The extra `10_000_000` converts whole XLM into stroops, while `1_000_000`
converts the USDC amount from base units into whole USDC. Multiplication,
exponentiation, and division are checked, and a conversion that rounds to zero
is rejected.
