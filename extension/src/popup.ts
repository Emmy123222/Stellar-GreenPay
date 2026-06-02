import {
  Asset,
  Horizon,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
} from '@stellar/stellar-sdk';

const HORIZON_URL = 'https://horizon-testnet.stellar.org';
const server = new Horizon.Server(HORIZON_URL);

interface DonationParams {
  destinationAddress: string;
  amountXlm: string;
  memo?: string;
}

async function buildDonationTransaction(
  sourceAddress: string,
  params: DonationParams
): Promise<string> {
  const account = await server.loadAccount(sourceAddress);

  const builder = new TransactionBuilder(account, {
    fee: (await server.fetchBaseFee()).toString(),
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      Operation.payment({
        destination: params.destinationAddress,
        asset: Asset.native(),
        amount: params.amountXlm,
      })
    )
    .setTimeout(30);

  if (params.memo) {
    builder.addMemo({ value: params.memo, type: 'text' } as any);
  }

  return builder.build().toXDR();
}

async function signWithFreighter(xdr: string): Promise<string> {
  const freighter = (window as any).freighter;
  if (!freighter) throw new Error('Freighter extension not found');

  const signedXdr: string = await freighter.signTransaction(xdr, {
    networkPassphrase: Networks.TESTNET,
  });
  return signedXdr;
}

async function submitTransaction(signedXdr: string): Promise<string> {
  const tx = TransactionBuilder.fromXDR(signedXdr, Networks.TESTNET);
  const result = await server.submitTransaction(tx as any);
  return (result as any).hash;
}

// --- Project search autocomplete ---

const API_BASE = 'https://api.stellar-greenpay.app';

interface ProjectResult {
  id: string;
  name: string;
  category: string;
}

let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
let activeDropdownIndex = -1;
let dropdownItems: HTMLLIElement[] = [];

function debounce(fn: () => void, ms: number) {
  if (searchDebounceTimer !== null) clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(fn, ms);
}

function renderDropdown(projects: ProjectResult[], dropdown: HTMLUListElement) {
  dropdown.innerHTML = '';
  dropdownItems = [];
  activeDropdownIndex = -1;

  if (projects.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'search-no-results';
    empty.textContent = 'No projects found';
    dropdown.appendChild(empty);
    dropdown.classList.remove('hidden');
    return;
  }

  projects.forEach((p) => {
    const li = document.createElement('li');
    li.innerHTML = `
      <div>
        <div class="search-result-name">${escapeHtml(p.name)}</div>
        <div class="search-result-cat">${escapeHtml(p.category)}</div>
      </div>
    `;
    li.addEventListener('mousedown', (e) => {
      e.preventDefault();
      window.open(`https://stellar-greenpay.app/projects/${p.id}`, '_blank');
      dropdown.classList.add('hidden');
    });
    dropdown.appendChild(li);
    dropdownItems.push(li);
  });

  dropdown.classList.remove('hidden');
}

function highlightDropdownItem(index: number) {
  dropdownItems.forEach((el, i) => {
    el.classList.toggle('active', i === index);
  });
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function fetchProjectSearch(query: string): Promise<ProjectResult[]> {
  const res = await fetch(`${API_BASE}/api/projects?search=${encodeURIComponent(query)}&limit=5`);
  if (!res.ok) throw new Error('Search failed');
  const json = await res.json();
  return (json.data ?? json) as ProjectResult[];
}

function initProjectSearch() {
  const input = document.getElementById('project-search') as HTMLInputElement | null;
  const dropdown = document.getElementById('search-dropdown') as HTMLUListElement | null;
  const wrapper = document.getElementById('search-wrapper');

  if (!input || !dropdown || !wrapper) return;

  input.addEventListener('input', () => {
    const q = input.value.trim();
    if (q.length < 2) {
      dropdown.classList.add('hidden');
      return;
    }
    debounce(async () => {
      try {
        const results = await fetchProjectSearch(q);
        renderDropdown(results, dropdown);
      } catch {
        dropdown.classList.add('hidden');
      }
    }, 300);
  });

  input.addEventListener('keydown', (e) => {
    if (dropdown.classList.contains('hidden')) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      activeDropdownIndex = Math.min(activeDropdownIndex + 1, dropdownItems.length - 1);
      highlightDropdownItem(activeDropdownIndex);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      activeDropdownIndex = Math.max(activeDropdownIndex - 1, 0);
      highlightDropdownItem(activeDropdownIndex);
    } else if (e.key === 'Enter' && activeDropdownIndex >= 0) {
      dropdownItems[activeDropdownIndex]?.dispatchEvent(new MouseEvent('mousedown'));
    } else if (e.key === 'Escape') {
      dropdown.classList.add('hidden');
    }
  });

  input.addEventListener('blur', () => {
    setTimeout(() => dropdown.classList.add('hidden'), 150);
  });
}

// --- UI wiring ---

function setStatus(message: string, isError = false) {
  const el = document.getElementById('status');
  if (!el) return;
  el.textContent = message;
  el.className = isError ? 'status error' : 'status success';
  el.style.display = 'block';
}

function setLoading(loading: boolean) {
  const btn = document.getElementById('donate-btn') as HTMLButtonElement | null;
  if (!btn) return;
  btn.disabled = loading;
  btn.textContent = loading ? 'Processing…' : 'Donate';
}

document.addEventListener('DOMContentLoaded', () => {
  initProjectSearch();

  const form = document.getElementById('donation-form');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const sourceAddress = ((document.getElementById('source-address') as HTMLInputElement)?.value ?? '').trim();
    const destination = ((document.getElementById('destination') as HTMLInputElement)?.value ?? '').trim();
    const amount = ((document.getElementById('amount') as HTMLInputElement)?.value ?? '').trim();
    const memo = ((document.getElementById('memo') as HTMLInputElement)?.value ?? '').trim();

    if (!sourceAddress || !destination || !amount) {
      setStatus('Please fill in all required fields.', true);
      return;
    }

    setLoading(true);
    setStatus('');

    try {
      setStatus('Building transaction…');
      const xdr = await buildDonationTransaction(sourceAddress, {
        destinationAddress: destination,
        amountXlm: amount,
        memo: memo || undefined,
      });

      setStatus('Waiting for Freighter signature…');
      const signedXdr = await signWithFreighter(xdr);

      setStatus('Submitting to Horizon testnet…');
      const txHash = await submitTransaction(signedXdr);

      setStatus(`Donation successful! TX: ${txHash.slice(0, 12)}…`);
    } catch (err: any) {
      const detail =
        err?.response?.data?.extras?.result_codes?.transaction ??
        err?.message ??
        'Unknown error';
      setStatus(`Transaction failed: ${detail}`, true);
    } finally {
      setLoading(false);
    }
  });
});
