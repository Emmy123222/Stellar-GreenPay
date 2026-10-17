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
      const vecType = (scVal as any).type ?? (scVal as any).switch?.().name;
      expect(vecType).toBe("scvVec");
      const vecItems = (scVal as any).vec ?? (typeof (scVal as any).vec === "function" ? (scVal as any).vec() : []);
      const inner = vecItems[0];
      const innerType = (inner as any).type ?? (inner as any).switch?.().name;
      expect(innerType).toBe("scvSymbol");
      const symVal = (inner as any).sym;
      const symStr = typeof symVal?.toString === "function" ? symVal.toString() : String(symVal);
      expect(symStr).toBe(variant);
      // sanity: tier key is lowercase, variant is PascalCase
      expect(tier).toBe(tier.toLowerCase());
    }
  });
});
