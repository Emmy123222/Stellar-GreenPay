import { render, screen } from "@testing-library/react";
import ImpactCertificate from "../ImpactCertificate";
import { badgeLabel } from "@/utils/format";
import type { BadgeTier } from "@/utils/types";

const baseProps = {
  donorAddress: "GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRST",
  donorName: "Jane Doe",
  totalDonatedXLM: "1500",
  totalCO2OffsetKg: 2400,
  badgeTier: "forest" as BadgeTier,
  projectsSupported: [
    { id: "p1", name: "Amazon Reforestation" },
    { id: "p2", name: "Solar for Schools" },
  ],
};

describe("ImpactCertificate", () => {
  // Pin the clock so the "Issued on …" date stays deterministic in snapshots.
  beforeAll(() => {
    jest.useFakeTimers().setSystemTime(new Date("2026-01-15T00:00:00.000Z"));
  });
  afterAll(() => {
    jest.useRealTimers();
  });

  it("renders the CO₂ offset value", () => {
    render(<ImpactCertificate {...baseProps} />);
    // formatCO2(2400) => "2.4k kg CO₂"
    expect(screen.getByText("2.4k kg CO₂")).toBeInTheDocument();
  });

  it("renders the donor name and key impact stats", () => {
    render(<ImpactCertificate {...baseProps} />);
    expect(screen.getByText("Jane Doe")).toBeInTheDocument();
    expect(screen.getByText("1,500 XLM")).toBeInTheDocument();
    expect(screen.getByText("Forest")).toBeInTheDocument();
    expect(screen.getByText("Amazon Reforestation")).toBeInTheDocument();
  });

  it("matches snapshot", () => {
    const { container } = render(<ImpactCertificate {...baseProps} />);
    expect(container).toMatchSnapshot();
  });

  it("renders the seedling badge tier", () => {
    render(<ImpactCertificate {...baseProps} badgeTier={"seedling" as BadgeTier} />);
    expect(screen.getByText("Seedling")).toBeInTheDocument();
  });

  it("renders the tree badge tier", () => {
    render(<ImpactCertificate {...baseProps} badgeTier={"tree" as BadgeTier} />);
    expect(screen.getByText("Tree")).toBeInTheDocument();
  });

  it("renders the forest badge tier", () => {
    render(<ImpactCertificate {...baseProps} badgeTier={"forest" as BadgeTier} />);
    expect(screen.getByText("Forest")).toBeInTheDocument();
  });

  it("renders the earth badge tier", () => {
    render(<ImpactCertificate {...baseProps} badgeTier={"earth" as BadgeTier} />);
    expect(screen.getByText("Earth Guardian")).toBeInTheDocument();
  });
});
