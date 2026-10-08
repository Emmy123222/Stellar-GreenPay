/**
 * components/ChartA11y.tsx
 *
 * Shared text alternatives for the recharts visualisations (issue #1314).
 *
 * Each chart is wrapped in an element with `role="img"` whose `aria-label`
 * describes the trend in one sentence, and is accompanied by a visually
 * hidden `<table>` carrying the exact series so screen-reader users get the
 * same numbers sighted users read off the chart.
 *
 * IMPORTANT: `role="img"` makes descendants presentational, so the table must
 * always be rendered as a *sibling* of the `role="img"` wrapper — never inside
 * it. Both are emitted together by `AccessibleChart` to keep that pairing
 * hard to get wrong.
 */
import type { ReactNode } from "react";

const formatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

export function formatChartValue(value: number): string {
  return formatter.format(value);
}

export interface ChartPoint {
  label: string;
  value: number;
}

/**
 * One-sentence trend summary for a line chart series, e.g.
 * "increased from 12.5 XLM at 2026-W01 to 30 XLM at 2026-W02, with a high of
 * 30 XLM at 2026-W02 and a low of 12.5 XLM at 2026-W01".
 */
export function describeLineTrend(points: ChartPoint[], unit: string): string {
  if (points.length === 0) return "no data available yet";
  if (points.length === 1) {
    return `a single value of ${formatChartValue(points[0].value)} ${unit} at ${points[0].label}`;
  }

  const first = points[0];
  const last = points[points.length - 1];
  let high = points[0];
  let low = points[0];
  for (const point of points) {
    if (point.value > high.value) high = point;
    if (point.value < low.value) low = point;
  }

  const summary = `${formatChartValue(first.value)} ${unit} at ${first.label} to ${formatChartValue(
    last.value,
  )} ${unit} at ${last.label}, with a high of ${formatChartValue(high.value)} ${unit} at ${
    high.label
  } and a low of ${formatChartValue(low.value)} ${unit} at ${low.label}`;

  if (last.value === first.value) return `flat at ${summary}`;
  return `${last.value > first.value ? "increased" : "decreased"} from ${summary}`;
}

/** `aria-label` for a line chart: "Title: trend description". */
export function lineChartAriaLabel(title: string, points: ChartPoint[], unit: string): string {
  return `${title}: ${describeLineTrend(points, unit)}`;
}

/** Comma-separated share listing for pie/donut charts, e.g. "Reforestation 45%, Solar Energy 30%". */
export function describeDistribution(
  items: Array<{ label: string; share: number }>,
): string {
  if (items.length === 0) return "no data available yet";
  return [...items]
    .sort((a, b) => b.share - a.share)
    .map((item) => `${item.label} ${formatChartValue(item.share)}%`)
    .join(", ");
}

export function VisuallyHiddenChartTable({
  caption,
  headers,
  rows,
}: {
  caption: string;
  headers: string[];
  rows: string[][];
}) {
  return (
    <table className="sr-only">
      <caption>{caption}</caption>
      <thead>
        <tr>
          {headers.map((header) => (
            <th key={header} scope="col">
              {header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, rowIndex) => (
          <tr key={rowIndex}>
            {row.map((cell, cellIndex) =>
              cellIndex === 0 ? (
                <th key={cellIndex} scope="row">
                  {cell}
                </th>
              ) : (
                <td key={cellIndex}>{cell}</td>
              ),
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * Pairs the `role="img"` wrapper with its visually hidden data table.
 * The wrapper keeps `className="h-full w-full"` so replacing a bare
 * `<ResponsiveContainer>` does not change the page layout.
 */
export function AccessibleChart({
  label,
  className = "h-full w-full",
  children,
  table,
}: {
  label: string;
  className?: string;
  children: ReactNode;
  table: { caption: string; headers: string[]; rows: string[][] };
}) {
  return (
    <>
      <div role="img" aria-label={label} className={className}>
        {children}
      </div>
      <VisuallyHiddenChartTable caption={table.caption} headers={table.headers} rows={table.rows} />
    </>
  );
}
