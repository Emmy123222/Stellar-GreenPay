import { Account, Keypair } from "@stellar/stellar-sdk";
import {
  buildBatchDonationTransaction,
  server,
} from "@/lib/stellar";

describe("buildBatchDonationTransaction", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("builds one native payment operation for each donation", async () => {
    const sourcePublicKey = Keypair.random().publicKey();
    const forestWallet = Keypair.random().publicKey();
    const solarWallet = Keypair.random().publicKey();
    jest.spyOn(server, "loadAccount").mockResolvedValue(
      new Account(sourcePublicKey, "1") as never,
    );

    const transaction = await buildBatchDonationTransaction({
      fromPublicKey: sourcePublicKey,
      payments: [
        { toPublicKey: forestWallet, amount: "12" },
        { toPublicKey: solarWallet, amount: "8" },
      ],
    });

    expect(transaction.operations).toHaveLength(2);
    expect(transaction.operations).toEqual([
      expect.objectContaining({
        type: "payment",
        destination: forestWallet,
        amount: "12.0000000",
      }),
      expect.objectContaining({
        type: "payment",
        destination: solarWallet,
        amount: "8.0000000",
      }),
    ]);
    expect(server.loadAccount).toHaveBeenCalledWith(sourcePublicKey);
  });
});
