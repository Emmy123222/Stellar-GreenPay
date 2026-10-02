import ImpactCertificate from "./ImpactCertificate";

const meta = {
  title: "Certificates/ImpactCertificate",
  component: ImpactCertificate,
  parameters: {
    layout: "centered",
  },
  argTypes: {
    badgeTier: {
      control: "select",
      options: ["seedling", "tree", "forest", "earth"],
    },
  },
};

export default meta;

const baseArgs = {
  donorAddress: "GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRST",
  donorName: "Jane Doe",
  totalDonatedXLM: "1500",
  totalCO2OffsetKg: 2400,
  projectsSupported: [
    { id: "p1", name: "Amazon Reforestation" },
    { id: "p2", name: "Solar for Schools" },
  ],
};

type Story = { args: typeof baseArgs & { badgeTier: "seedling" | "tree" | "forest" | "earth" } };

export const Seedling: Story = {
  args: { ...baseArgs, badgeTier: "seedling" },
};

export const Tree: Story = {
  args: { ...baseArgs, badgeTier: "tree" },
};

export const Forest: Story = {
  args: { ...baseArgs, badgeTier: "forest" },
};

export const Earth: Story = {
  args: { ...baseArgs, badgeTier: "earth" },
};
