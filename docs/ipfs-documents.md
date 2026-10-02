# IPFS Document Storage Guide for Project Owners

This guide explains how project documents are stored on IPFS in Stellar-GreenPay and how you can verify and manage your project's documents.

## Why IPFS?

Stellar-GreenPay stores project documents on IPFS (InterPlanetary File System) for several key reasons:

### Permanent Storage
- **Content Addressing**: Documents are identified by their content hash (CID), not by location
- **Immutability**: Once a document is added to IPFS, its content cannot be changed without changing the CID
- **Tamper-proof**: Any modification to a document results in a completely different CID, making tampering immediately detectable

### Decentralised Architecture
- **No Single Point of Failure**: Documents are distributed across the IPFS network rather than stored on a central server
- **Resilience**: Documents remain accessible as long as at least one node on the network hosts the content
- **Network Effect**: More nodes hosting content increases availability and retrieval speed

### Censorship Resistance
- **No Central Authority**: No single entity can remove or block access to your documents
- **Global Accessibility**: Documents are accessible from anywhere in the world without geographic restrictions
- **Permissionless**: Anyone can retrieve and verify documents without requiring approval

## Verifying Your Document CID

You can verify that your document's content matches the CID stored on-chain using the IPFS command-line tools.

### Prerequisites

Install IPFS:
```bash
# On macOS
brew install ipfs

# On Linux
sudo apt-get install ipfs

# On Windows
# Download from https://dist.ipfs.io/#go-ipfs
# Or use WSL on Windows
```

Initialize IPFS (first time only):
```bash
ipfs init
```

Start the IPFS daemon:
```bash
ipfs daemon
```

### Verification Steps

1. **Retrieve the CID from your project metadata**
   
   Your project's on-chain `project_metadata` contains the document CID. You can query this using the Stellar-GreenPay API or blockchain explorer.

2. **Verify the document content**
   
   Use `ipfs cat` to retrieve and display the document:
   ```bash
   ipfs cat <your-document-cid>
   ```

   For example:
   ```bash
   ipfs cat QmXoypizjW3WknFiJnKLwHCnL72vedxjQkDDP1mXWo6uco
   ```

3. **Compare with your local file**
   
   To verify the content matches your local document:
   ```bash
   # Download the IPFS content
   ipfs get <your-document-cid> -o downloaded-document.pdf
   
   # Compare with your local file (on Linux/macOS)
   diff downloaded-document.pdf your-local-document.pdf
   
   # Or compare hashes
   sha256sum downloaded-document.pdf
   sha256sum your-local-document.pdf
   ```

4. **Verify CID integrity**
   
   You can also verify that a local file produces the expected CID:
   ```bash
   ipfs add --only-hash your-local-document.pdf
   ```
   
   This will output the CID without actually adding the file to IPFS. Compare this with the on-chain CID.

## Pinning Your Documents

While IPFS provides content addressing, documents need to be "pinned" by nodes to ensure long-term availability. You can independently pin your documents using popular pinning services.

### Pinata

Pinata is a popular IPFS pinning service with a user-friendly interface.

1. **Create a Pinata account**
   - Visit https://pinata.cloud
   - Sign up for a free or paid account

2. **Get your API keys**
   - Navigate to API Keys in your account settings
   - Generate new API keys (keep these secure)

3. **Pin your document**
   
   Using the Pinata dashboard:
   - Go to the "Pin Manager" tab
   - Click "Upload" and select your document
   - Pinata will provide you with the CID
   
   Using the Pinata API:
   ```bash
   curl -X POST https://api.pinata.cloud/pinning/pinFileToIPFS \
     -H "Authorization: Bearer <your-jwt-token>" \
     -F "file=@your-document.pdf"
   ```

4. **Verify the pin**
   - Check the "Pin Manager" to see your pinned content
   - The CID should match your on-chain document CID

### web3.storage

web3.storage is a free IPFS pinning service backed by Filecoin.

1. **Create a web3.storage account**
   - Visit https://web3.storage
   - Sign up using your email or Web3 wallet

2. **Get your API token**
   - Navigate to API Tokens in your account settings
   - Create a new API token

3. **Pin your document**
   
   Using the web3.storage CLI:
   ```bash
   # Install the CLI
   npm install -g @web3-storage/w3cli
   
   # Login
   w3 token <your-api-token>
   
   # Upload your document
   w3 put your-document.pdf
   ```
   
   Using the web3.storage API:
   ```bash
   curl -X POST https://api.web3.storage/upload \
     -H "Authorization: Bearer <your-api-token>" \
     -F "file=@your-document.pdf"
   ```

4. **Verify the pin**
   - Check your web3.storage dashboard
   - The CID should match your on-chain document CID

### Other Pinning Options

- **Filebase**: https://filebase.com
- **Lighthouse**: https://lighthouse.storage
- **NFT.Storage**: https://nft.storage
- **Self-hosted**: Run your own IPFS node and pin locally

## Link Between On-Chain Metadata and IPFS Documents

The Stellar-GreenPay smart contracts maintain a direct link between on-chain project metadata and IPFS document storage.

### Project Metadata Structure

Your project's on-chain `project_metadata` includes:

```json
{
  "name": "Your Project Name",
  "description": "Project description",
  "document_cid": "QmXoypizjW3WknFiJnKLwHCnL72vedxjQkDDP1mXWo6uco",
  "document_type": "whitepaper",
  "document_hash": "0x...",
  "timestamp": 1234567890
}
```

### Verification Flow

1. **On-Chain Lookup**: Query the smart contract to get the document CID
2. **IPFS Retrieval**: Use the CID to fetch the document from IPFS
3. **Content Verification**: Verify the document content matches expectations
4. **Hash Verification**: Compare the document's cryptographic hash with on-chain data

### Smart Contract Integration

The smart contract enforces that:
- Document CIDs are immutable once set
- Only authorized project owners can update document metadata
- Document hashes are stored for additional verification
- All changes are logged on-chain for audit trails

### API Integration

Stellar-GreenPay provides API endpoints to:
- Retrieve project metadata including document CID
- Fetch documents directly from IPFS
- Verify document integrity
- List all project documents

## Best Practices

### Security
- **Keep API Keys Secure**: Never commit pinning service API keys to version control
- **Verify CIDs**: Always verify CIDs match before and after uploading
- **Use Environment Variables**: Store sensitive credentials in environment variables

### Redundancy
- **Multiple Pinning Services**: Pin documents on multiple services for redundancy
- **Local Backup**: Maintain local copies of all important documents
- **Monitor Pin Status**: Regularly check that your documents remain pinned

### Documentation
- **Record CIDs**: Keep a record of all document CIDs in your project documentation
- **Document Changes**: Log any document updates with corresponding CID changes
- **Version Control**: Use semantic versioning for document updates

## Troubleshooting

### Document Not Found
If you receive a "document not found" error when trying to retrieve a CID:
- Verify the CID is correct (check for typos)
- Ensure the document is pinned by at least one node
- Try using a public IPFS gateway: https://ipfs.io/ipfs/<cid>

### CID Mismatch
If your local file produces a different CID:
- Ensure you're using the exact same file (no modifications)
- Check for hidden files or metadata differences
- Verify you're using the same hashing algorithm (default is sha2-256)

### Pinning Issues
If pinning fails:
- Check your API credentials are valid
- Ensure your file size is within service limits
- Verify your internet connection is stable
- Try an alternative pinning service

## Additional Resources

- **IPFS Documentation**: https://docs.ipfs.io
- **Pinata Documentation**: https://docs.pinata.cloud
- **web3.storage Documentation**: https://web3.storage/docs
- **Stellar-GreenPay API**: See `docs/api.md` for API endpoints
- **Smart Contract Reference**: See contracts directory for implementation details

## Support

If you encounter issues with IPFS document storage:
- Check the Stellar-GreenPay documentation in the `docs/` directory
- Review existing issues on GitHub
- Open a new issue with detailed error information
- Contact the Stellar-GreenPay team through official channels
