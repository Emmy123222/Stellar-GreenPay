const fs = require('fs');
const path = require('path');

// Pull contract addresses from the shared source of truth so the mobile app
// never needs a manual update when contracts are redeployed.
function loadAddresses(network) {
  const p = path.resolve(__dirname, '../contracts/addresses.json');
  if (!fs.existsSync(p)) return {};
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'))[network] || {};
  } catch {
    return {};
  }
}

const network = process.env.EXPO_PUBLIC_STELLAR_NETWORK || 'testnet';
const addresses = loadAddresses(network);

module.exports = ({ config }) => ({
  ...config,
  extra: {
    ...config.extra,
    contractId: addresses.greenpay || process.env.EXPO_PUBLIC_CONTRACT_ID || '',
    escrowContractId: addresses.escrow || process.env.EXPO_PUBLIC_ESCROW_CONTRACT_ID || '',
  },
});
