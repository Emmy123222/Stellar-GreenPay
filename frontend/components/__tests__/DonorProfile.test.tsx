import React from 'react';
import { render, act, screen } from '@testing-library/react';
import DonorProfilePage from '../../pages/donors/[publicKey]';
import { useRouter } from 'next/router';
import { fetchProfile, fetchDonorHistoryPage } from '@/lib/api';

jest.mock('next/router', () => ({
  useRouter: jest.fn(),
}));

jest.mock('@/lib/api', () => ({
  fetchProfile: jest.fn(),
  fetchDonorHistoryPage: jest.fn(),
}));

const mockDonations = [
  {
    id: "1",
    projectId: "proj-1",
    donorAddress: "G1234567890123456789012345678901234567890123456789012345",
    amountXLM: "100",
    currency: "XLM",
    transactionHash: "hash",
    createdAt: "2023-01-01T00:00:00.000Z"
  }
];

const firstPage = {
  donations: mockDonations,
  hasMore: false,
  nextCursor: null,
  total: mockDonations.length,
};

describe('DonorProfile Component', () => {
  beforeEach(() => {
    (useRouter as jest.Mock).mockReturnValue({
      query: { publicKey: 'G1234567890123456789012345678901234567890123456789012345' },
    });
    (fetchDonorHistoryPage as jest.Mock).mockResolvedValue(firstPage);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  const tiers = [
    { name: 'None', badges: [] },
    { name: 'Seedling', badges: [{ tier: 'seedling', earnedAt: '2023-01-01T00:00:00.000Z' }] },
    { name: 'Tree', badges: [{ tier: 'tree', earnedAt: '2023-01-01T00:00:00.000Z' }] },
    { name: 'Forest', badges: [{ tier: 'forest', earnedAt: '2023-01-01T00:00:00.000Z' }] },
    { name: 'EarthGuardian', badges: [{ tier: 'earth', earnedAt: '2023-01-01T00:00:00.000Z' }] },
  ];

  it.each(tiers)('matches snapshot for badge tier: $name', async ({ badges }) => {
    (fetchProfile as jest.Mock).mockResolvedValue({
      publicKey: 'G1234567890123456789012345678901234567890123456789012345',
      displayName: 'Test Donor',
      bio: 'Test bio',
      totalDonatedXLM: '1000',
      projectsSupported: 5,
      badges,
      createdAt: '2023-01-01T00:00:00.000Z',
    });

    let component: ReturnType<typeof render> | undefined;
    await act(async () => {
      component = render(<DonorProfilePage />);
    });

    expect(component?.container).toMatchSnapshot();
  });

  // ── Paginated donation history (issue #1080) ─────────────────────────────

  const mockProfile = {
    publicKey: 'G1234567890123456789012345678901234567890123456789012345',
    displayName: 'Test Donor',
    bio: 'Test bio',
    totalDonatedXLM: '1000',
    projectsSupported: 5,
    badges: [],
    createdAt: '2023-01-01T00:00:00.000Z',
  };

  const secondPage = {
    donations: [
      { ...mockDonations[0], id: '2', createdAt: '2022-12-31T00:00:00.000Z' },
      { ...mockDonations[0], id: '3', createdAt: '2022-12-30T00:00:00.000Z' },
    ],
    hasMore: false,
    nextCursor: null,
    total: 3,
  };

  /**
   * @param page - Value the first `fetchDonorHistoryPage` call resolves with.
   */
  async function renderWithPage(page: unknown) {
    (fetchProfile as jest.Mock).mockResolvedValue(mockProfile);
    (fetchDonorHistoryPage as jest.Mock).mockResolvedValue(page);
    await act(async () => {
      render(<DonorProfilePage />);
    });
  }

  it('requests a bounded first page instead of the whole history', async () => {
    await renderWithPage(firstPage);

    expect(fetchDonorHistoryPage).toHaveBeenCalledWith(expect.any(String), {
      limit: 20,
    });
  });

  it('shows how much of the history is on screen', async () => {
    await renderWithPage({ ...firstPage, hasMore: true, nextCursor: 'cursor-1', total: 3 });

    expect(screen.getByText(/Showing 1 of 3 donations/)).toBeInTheDocument();
  });

  it('does not offer more rows once the last page has loaded', async () => {
    await renderWithPage(firstPage);

    expect(screen.queryByRole('button', { name: /load .* more/i })).not.toBeInTheDocument();
  });

  it('appends the next page when "Load more" is clicked', async () => {
    await renderWithPage({ ...firstPage, hasMore: true, nextCursor: 'cursor-1', total: 3 });
    (fetchDonorHistoryPage as jest.Mock).mockResolvedValue(secondPage);

    const button = screen.getByRole('button', { name: /load 2 more/i });
    await act(async () => {
      button.click();
    });

    expect(fetchDonorHistoryPage).toHaveBeenLastCalledWith(expect.any(String), {
      limit: 20,
      cursor: 'cursor-1',
    });
    expect(screen.getByText(/Showing 3 of 3 donations/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /load .* more/i })).not.toBeInTheDocument();
  });
});
