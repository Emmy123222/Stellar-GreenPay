/**
 * Story documenting the accessible rendering of DonationGrowthChart (#1314).
 *
 * The chart is wrapped in `role="img"` with an `aria-label` that describes the
 * trend in one sentence, and followed by a visually hidden `<table>` that
 * mirrors the weekly series for screen-reader users. Reveal the table in the
 * accessibility panel (or by removing `.sr-only`) to inspect the numbers.
 *
 * Note: Storybook itself is not wired up in this repo yet; this file follows
 * the same CSF shape as `ImpactCertificate.stories.tsx`.
 */
import DonationGrowthChart from "./DonationGrowthChart";

const meta = {
  title: "Charts/DonationGrowthChart",
  component: DonationGrowthChart,
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "Weekly donation growth line chart with a text alternative: the chart " +
          "region carries role=\"img\" and an aria-label summarising the trend " +
          "(\"Weekly XLM donations over time: increased from … to …\"), and a " +
          "visually hidden table lists every week and its XLM total.",
      },
    },
  },
};

export default meta;

const baseArgs = {
  data: [
    { week: "2026-W01", totalXLM: 12.5 },
    { week: "2026-W02", totalXLM: 30 },
    { week: "2026-W03", totalXLM: 24 },
    { week: "2026-W04", totalXLM: 61.75 },
    { week: "2026-W05", totalXLM: 80 },
  ],
};

type Story = {
  args: typeof baseArgs;
  parameters?: { docs?: { description?: { story?: string } } };
};

export const AccessibleLineChart: Story = {
  args: { ...baseArgs },
  parameters: {
    docs: {
      description: {
        story:
          "Accessible version: role=\"img\" + trend aria-label on the chart " +
          "region, plus an sr-only table with columns Week / XLM donated.",
      },
    },
  },
};

export const NoData: Story = {
  args: { data: [] },
  parameters: {
    docs: {
      description: {
        story:
          "Empty series renders the visible \"No donations recorded yet.\" " +
          "state, so no chart region or hidden table is announced.",
      },
    },
  },
};
