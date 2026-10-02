import React from 'react';

export default function WorldMap({ countryBreakdown = [] }: { countryBreakdown?: { country: string; totalDonationsXLM: string; donorCount: number }[] }) {
  const locations = [
    { cx: 220, cy: 120, name: 'North America', country: 'US' },
    { cx: 260, cy: 90, name: 'Europe', country: 'GB' },
    { cx: 520, cy: 220, name: 'Africa', country: 'NG' },
    { cx: 680, cy: 140, name: 'Asia', country: 'IN' },
    { cx: 800, cy: 280, name: 'Australia', country: 'AU' },
  ];

  const maxDonation = Math.max(...countryBreakdown.map((row) => Number(row.totalDonationsXLM)), 1);

  return (
    <div className="w-full flex flex-col items-center py-4 relative group">
      <p className="text-sm text-forest-500 mb-4 font-medium">Donor country heatmap and top contributors</p>
      <div className="flex flex-col lg:flex-row gap-6 w-full">
        <div className="flex-1">
          <svg
            viewBox="0 0 1000 500"
            className="w-full max-w-4xl drop-shadow-md rounded-3xl overflow-hidden"
            fill="none"
            stroke="currentColor"
          >
            <path d="M 120 100 Q 150 40 250 80 T 300 150 T 250 200 T 150 180 Z" fill="#e2ede2" stroke="#a3cca3" strokeWidth="2" />
            <path d="M 230 200 Q 300 200 320 280 Q 300 400 280 420 Q 250 350 220 250 Z" fill="#e2ede2" stroke="#a3cca3" strokeWidth="2" />
            <path d="M 400 80 Q 480 50 520 80 T 500 150 Q 450 160 420 140 Z" fill="#e2ede2" stroke="#a3cca3" strokeWidth="2" />
            <path d="M 440 160 Q 550 150 580 220 Q 550 350 520 360 Q 480 300 460 250 Z" fill="#e2ede2" stroke="#a3cca3" strokeWidth="2" />
            <path d="M 500 80 Q 600 40 750 60 T 800 150 Q 750 220 650 200 Q 550 180 520 120 Z" fill="#e2ede2" stroke="#a3cca3" strokeWidth="2" />
            <path d="M 750 250 Q 820 230 850 280 Q 820 330 780 320 Z" fill="#e2ede2" stroke="#a3cca3" strokeWidth="2" />

            {locations.map((loc, i) => {
              const countryRow = countryBreakdown.find((row) => row.country === loc.country);
              const intensity = countryRow ? Math.min(1, Number(countryRow.totalDonationsXLM) / maxDonation) : 0;
              const fill = countryRow ? `rgba(34, 114, 57, ${0.25 + intensity * 0.5})` : '#e2ede2';

              return (
                <g key={i}>
                  <circle cx={loc.cx} cy={loc.cy} r="18" fill={fill} />
                  <circle cx={loc.cx} cy={loc.cy} r="8" fill="#227239" />
                  <text x={loc.cx} y={loc.cy - 20} className="text-xs fill-forest-700 font-bold" textAnchor="middle">
                    {loc.name}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
        <div className="w-full lg:w-96 bg-forest-50/40 rounded-3xl border border-forest-100 p-6">
          <div className="mb-4">
            <h3 className="text-lg font-semibold text-forest-900">Top donor countries</h3>
            <p className="text-sm text-forest-500">Showing the largest donation sources by country.</p>
          </div>
          {countryBreakdown.length > 0 ? (
            <div className="space-y-3">
              {countryBreakdown.slice(0, 10).map((row) => (
                <div key={row.country} className="rounded-2xl bg-white p-4 border border-forest-100">
                  <div className="flex items-center justify-between gap-4">
                    <span className="font-semibold text-forest-800">{row.country}</span>
                    <span className="text-sm text-forest-500">{row.donorCount} donor{row.donorCount !== 1 ? 's' : ''}</span>
                  </div>
                  <div className="mt-2 h-2 rounded-full bg-forest-100 overflow-hidden">
                    <div className="h-full bg-forest-600" style={{ width: `${Math.min(100, Number(row.totalDonationsXLM) / maxDonation * 100)}%` }} />
                  </div>
                  <div className="mt-2 text-xs text-forest-500">{Number(row.totalDonationsXLM).toFixed(2)} XLM</div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-forest-500">No country data available yet.</p>
          )}
        </div>
      </div>
    </div>
  );
}
