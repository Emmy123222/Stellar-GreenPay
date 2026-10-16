import React, { useState, useEffect } from 'react';
import Head from 'next/head';

interface ProjectProposal {
  id: string;
  name: string;
  proposer: string;
  carbonOffsetEstimate: string;
  status: 'Pending' | 'Approved' | 'Rejected';
  votesFor: number;
  votesAgainst: number;
}

export default function GovernancePage() {
  const [hasNft, setHasNft] = useState<boolean>(false);
  const [isMinting, setIsMinting] = useState<boolean>(false);
  const [proposals, setProposals] = useState<ProjectProposal[]>([
    {
      id: 'prop-1',
      name: 'Amazon Reforestation Initiative Phase II',
      proposer: 'GB-EcoDAO',
      carbonOffsetEstimate: '45,000 tCO2e',
      status: 'Pending',
      votesFor: 12,
      votesAgainst: 2,
    },
    {
      id: 'prop-2',
      name: 'Solar Microgrid Rural electrification',
      proposer: 'SolDev Africa',
      carbonOffsetEstimate: '18,500 tCO2e',
      status: 'Pending',
      votesFor: 8,
      votesAgainst: 5,
    },
  ]);
  const [notification, setNotification] = useState<string | null>(null);

  const handleMintImpactNft = async () => {
    setIsMinting(true);
    setNotification(null);
    try {
      // Simulate Soroban contract invocation for mint_impact_nft
      await new Promise((resolve) => setTimeout(resolve, 1500));
      setHasNft(true);
      setNotification('Successfully minted Impact NFT! You are now a verified badge-holder governance member.');
    } catch {
      setNotification('Failed to mint Impact NFT. Please try again.');
    } finally {
      setIsMinting(false);
    }
  };

  const handleVote = (proposalId: string, support: boolean) => {
    if (!hasNft) {
      setNotification('Error: You must hold a verified Impact NFT (has_nft) to vote on proposals.');
      return;
    }

    setProposals((prev) =>
      prev.map((prop) => {
        if (prop.id === proposalId) {
          return {
            ...prop,
            votesFor: support ? prop.votesFor + 1 : prop.votesFor,
            votesAgainst: !support ? prop.votesAgainst + 1 : prop.votesAgainst,
          };
        }
        return prop;
      })
    );
    setNotification(`Successfully cast your vote for proposal ${proposalId}!`);
  };

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 py-10 px-4 sm:px-6 lg:px-8">
      <Head>
        <title>GreenPay Governance | Badge-Holder Voting</title>
      </Head>

      <div className="max-w-5xl mx-auto">
        <header className="mb-8 border-b border-slate-800 pb-6">
          <h1 className="text-3xl font-bold tracking-tight text-emerald-400">GreenPay DAO Governance</h1>
          <p className="mt-2 text-slate-400">
            Badge-holder governance portal for reviewing and voting on new sustainability project registrations.
          </p>
        </header>

        {notification && (
          <div className="mb-6 p-4 rounded-lg bg-emerald-950/60 border border-emerald-500/30 text-emerald-300 text-sm">
            {notification}
          </div>
        )}

        {/* Badge Holder Status Card */}
        <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-6 mb-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold text-slate-200">Badge-Holder Status</h2>
            <p className="text-sm text-slate-400 mt-1">
              {hasNft
                ? 'Verified Badge Holder: You have full voting rights on project registrations.'
                : 'You do not currently hold an Impact NFT. Mint one to participate in governance.'}
            </p>
          </div>
          {!hasNft ? (
            <button
              onClick={handleMintImpactNft}
              disabled={isMinting}
              className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-medium rounded-lg transition"
            >
              {isMinting ? 'Minting Impact NFT...' : 'Mint Impact NFT (mint_impact_nft)'}
            </button>
          ) : (
            <span className="px-4 py-1.5 bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 rounded-full text-sm font-medium">
              ✓ Verified Member
            </span>
          )}
        </div>

        {/* Proposals Section */}
        <section>
          <h2 className="text-2xl font-semibold mb-4 text-slate-200">Active Project Registration Proposals</h2>
          <div className="space-y-4">
            {proposals.map((proposal) => (
              <div key={proposal.id} className="bg-slate-800/40 border border-slate-700/80 rounded-xl p-6 shadow-sm">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
                  <div>
                    <span className="text-xs uppercase tracking-wider font-semibold text-emerald-400 bg-emerald-950/40 px-2.5 py-1 rounded">
                      {proposal.status}
                    </span>
                    <h3 className="text-lg font-bold text-slate-100 mt-2">{proposal.name}</h3>
                    <p className="text-xs text-slate-400">Proposer: {proposal.proposer} | Estimate: {proposal.carbonOffsetEstimate}</p>
                  </div>
                  <div className="flex items-center gap-3 text-sm">
                    <span className="text-emerald-400 font-semibold">For: {proposal.votesFor}</span>
                    <span className="text-rose-400 font-semibold">Against: {proposal.votesAgainst}</span>
                  </div>
                </div>

                <div className="flex items-center gap-3 pt-4 border-t border-slate-700/50">
                  <button
                    onClick={() => handleVote(proposal.id, true)}
                    className="px-4 py-2 bg-emerald-700/60 hover:bg-emerald-600 text-emerald-100 text-sm font-medium rounded-lg transition"
                  >
                    Vote Approve
                  </button>
                  <button
                    onClick={() => handleVote(proposal.id, false)}
                    className="px-4 py-2 bg-rose-900/40 hover:bg-rose-800 text-rose-200 text-sm font-medium rounded-lg transition"
                  >
                    Vote Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
