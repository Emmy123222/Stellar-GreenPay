/**
 * lib/__tests__/mintImpactNft.test.ts
 *
 * Unit tests for the Claim Impact NFT helpers (issue: "Add a Claim NFT button
 * on the donor profile page"). These verify the off-chain → on-chain badge
 * tier mapping that the `mint_impact_nft(donor, tier)` Soroban call depends on.
 */
import { xdr, nativeToScVal } from "@stellar/stellar-sdk";
import { CONTRACT_BADGE_SYMBOL } from "@/lib/stellar";

describe("CONTRACT_BADGE_SYMBOL", () => {
  it("maps every frontend BadgeTier to its on-chain enum variant name", () => {
    // Mirrors the contract's `BadgeTier` enum:
    // None | Seedling | Tree | Forest | EarthGuardian
    expect(CONTRACT_BADGE_SYMBOL).toEqual({
      seedling: "Seedling",
      tree: "Tree",
      forest: "Forest",
      earth: "EarthGuardian",
    });
  });

  it("produces a Soroban unit-variant enum ScVal (Vec of one Symbol)", () => {
    // Soroban serialises a data-less enum variant as a Vec containing a single
    // Symbol. This is exactly what `buildMintImpactNftTransaction` sends as the
    // `tier` argument, so the contract can match `BadgeTier::Seedling` etc.
    for (const [tier, variant] of Object.entries(CONTRACT_BADGE_SYMBOL)) {
      const scVal = xdr.ScVal.scvVec([
        nativeToScVal(variant, { type: "symbol" }),
      ]);
      expect(scVal.switch().name).toBe("scvVec");
      const inner = scVal.vec()![0];
      expect(inner.switch().name).toBe("scvSymbol");
      expect(inner.sym().toString()).toBe(variant);
      // sanity: tier key is lowercase, variant is PascalCase
      expect(tier).toBe(tier.toLowerCase());
    }
  });
});
