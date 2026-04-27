import { isAllowed, setAllowed, getUserInfo } from '@stellar/freighter-api';

// DOM Elements
const connectBtn = document.getElementById('connect-btn') as HTMLButtonElement;
const walletInfo = document.getElementById('wallet-info') as HTMLDivElement;
const walletAddress = document.getElementById('wallet-address') as HTMLSpanElement;
const walletBalance = document.getElementById('wallet-balance') as HTMLHeadingElement;
const projectList = document.getElementById('project-list') as HTMLUListElement;
const presetBtns = document.querySelectorAll('.preset-btn') as NodeListOf<HTMLButtonElement>;
const customInput = document.getElementById('custom-amount-input') as HTMLInputElement;
const donateBtn = document.getElementById('donate-submit') as HTMLButtonElement;
const statusMsg = document.getElementById('status-message') as HTMLDivElement;

let currentAddress = '';
let activeProjectId = '';
let currentDonationAmount = 0;

// Setup Event Listeners
connectBtn.addEventListener('click', connectWallet);
customInput.addEventListener('input', handleCustomInput);
donateBtn.addEventListener('click', handleDonate);

presetBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    presetBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    customInput.value = '';
    currentDonationAmount = parseFloat(btn.dataset.amount || '0');
    updateDonateBtn();
  });
});

async function connectWallet() {
  try {
    const allowed = await isAllowed();
    if (!allowed) {
      await setAllowed();
    }
    
    statusMsg.textContent = 'Connecting...';
    statusMsg.className = 'status-message';

    const info = await getUserInfo();
    if (info.publicKey) {
      currentAddress = info.publicKey;
      
      // Update UI
      connectBtn.classList.add('hidden');
      walletInfo.classList.remove('hidden');
      
      // Format address: GABCD...WXYZ
      const shortAddr = `${currentAddress.slice(0, 5)}...${currentAddress.slice(-4)}`;
      walletAddress.textContent = shortAddr;

      statusMsg.textContent = '';
      fetchBalance(currentAddress);
      fetchProjects();
    } else {
      showError('Freighter is locked or not installed.');
    }
  } catch (error: any) {
    showError(error.message || 'Failed to connect to Freighter.');
  }
}

async function fetchBalance(pubKey: string) {
  try {
    // Determine network based on Freighter response if possible, defaulting to mainnet or testnet
    const response = await fetch(`https://horizon-testnet.stellar.org/accounts/${pubKey}`);
    if (response.ok) {
      const data = await response.json();
      const nativeBalance = data.balances.find((b: any) => b.asset_type === 'native');
      if (nativeBalance) {
        walletBalance.textContent = `${parseFloat(nativeBalance.balance).toFixed(2)} XLM`;
      }
    } else {
      walletBalance.textContent = '0.00 XLM';
    }
  } catch (error) {
    console.error('Error fetching balance:', error);
  }
}

async function fetchProjects() {
  // TODO: Implement actual API call to GreenPay backend
  // Simulating mock response for now
  projectList.classList.remove('skeleton'); // Remove skeleton styling approach
  projectList.innerHTML = '';
  
  const mockProjects = [
    { id: '1', name: 'Ocean Cleanup', desc: 'Removing plastic from the Pacific...' },
    { id: '2', name: 'Reforest Amazon', desc: 'Planting 10k trees by year end.' },
    { id: '3', name: 'Solar for Schools', desc: 'Micro-solar grids for rural...' }
  ];

  mockProjects.forEach((proj, idx) => {
    const li = document.createElement('li');
    li.className = `glass-panel project-item ${idx === 0 ? 'active' : ''}`;
    if (idx === 0) activeProjectId = proj.id;

    li.innerHTML = `
      <div class="project-avatar"></div>
      <div class="project-info">
        <div class="project-name">${proj.name}</div>
        <div class="project-desc">${proj.desc}</div>
      </div>
    `;

    li.addEventListener('click', () => {
      document.querySelectorAll('.project-item').forEach(el => el.classList.remove('active'));
      li.classList.add('active');
      activeProjectId = proj.id;
    });

    projectList.appendChild(li);
  });
}

function handleCustomInput(e: Event) {
  const target = e.target as HTMLInputElement;
  presetBtns.forEach(b => b.classList.remove('active'));
  currentDonationAmount = parseFloat(target.value) || 0;
  updateDonateBtn();
}

function updateDonateBtn() {
  donateBtn.disabled = currentDonationAmount <= 0;
}

async function handleDonate() {
  if (!currentAddress || !activeProjectId || currentDonationAmount <= 0) return;
  
  try {
    statusMsg.className = 'status-message';
    statusMsg.textContent = 'Initiating donation...';
    donateBtn.disabled = true;

    // TODO: Build transaction using stellar-sdk and sign with Freighter
    // For now we will mock success
    setTimeout(() => {
      showSuccess(`Successfully donated ${currentDonationAmount} XLM!`);
    }, 1500);

  } catch (error: any) {
    showError(error.message || 'Donation failed.');
  } finally {
    donateBtn.disabled = false;
  }
}

function showError(msg: string) {
  statusMsg.textContent = msg;
  statusMsg.className = 'status-message error';
}

function showSuccess(msg: string) {
  statusMsg.textContent = msg;
  statusMsg.className = 'status-message success';
}
