import React from 'react';

export default function WorldMap() {
  // Hardcoded locations for visual demonstration
  const locations = [
    { cx: 220, cy: 120, name: "North America" },
    { cx: 280, cy: 260, name: "South America" },
    { cx: 480, cy: 110, name: "Europe" },
    { cx: 520, cy: 220, name: "Africa" },
    { cx: 680, cy: 140, name: "Asia" },
    { cx: 800, cy: 280, name: "Australia" },
    { cx: 720, cy: 200, name: "Southeast Asia" },
  ];

  return (
    <div className="w-full flex flex-col items-center py-4 relative group">
      <p className="text-sm text-forest-500 mb-4 font-medium">Active project regions</p>
      
      <svg 
        viewBox="0 0 1000 500" 
        className="w-full max-w-4xl drop-shadow-md" 
        fill="none" 
        stroke="currentColor"
      >
        {/* Simple stylized world map paths */}
        {/* North America */}
        <path d="M 120 100 Q 150 40 250 80 T 300 150 T 250 200 T 150 180 Z" fill="#e2ede2" stroke="#a3cca3" strokeWidth="2" className="transition-colors hover:fill-[#c8dac8]" />
        {/* South America */}
        <path d="M 230 200 Q 300 200 320 280 Q 300 400 280 420 Q 250 350 220 250 Z" fill="#e2ede2" stroke="#a3cca3" strokeWidth="2" className="transition-colors hover:fill-[#c8dac8]" />
        {/* Europe */}
        <path d="M 400 80 Q 480 50 520 80 T 500 150 Q 450 160 420 140 Z" fill="#e2ede2" stroke="#a3cca3" strokeWidth="2" className="transition-colors hover:fill-[#c8dac8]" />
        {/* Africa */}
        <path d="M 440 160 Q 550 150 580 220 Q 550 350 520 360 Q 480 300 460 250 Z" fill="#e2ede2" stroke="#a3cca3" strokeWidth="2" className="transition-colors hover:fill-[#c8dac8]" />
        {/* Asia */}
        <path d="M 500 80 Q 600 40 750 60 T 800 150 Q 750 220 650 200 Q 550 180 520 120 Z" fill="#e2ede2" stroke="#a3cca3" strokeWidth="2" className="transition-colors hover:fill-[#c8dac8]" />
        {/* Australia */}
        <path d="M 750 250 Q 820 230 850 280 Q 820 330 780 320 Z" fill="#e2ede2" stroke="#a3cca3" strokeWidth="2" className="transition-colors hover:fill-[#c8dac8]" />
        
        {/* Pulsing Dots for Projects */}
        {locations.map((loc, i) => (
          <g key={i}>
            <circle cx={loc.cx} cy={loc.cy} r="16" fill="#227239" className="opacity-20 animate-ping" />
            <circle cx={loc.cx} cy={loc.cy} r="6" fill="#227239" className="shadow-lg" />
            <text x={loc.cx} y={loc.cy - 15} className="text-xs fill-forest-700 font-bold opacity-0 transition-opacity duration-300" textAnchor="middle">{loc.name}</text>
          </g>
        ))}
      </svg>
      <style>{`
        g:hover text {
          opacity: 1;
        }
      `}</style>
    </div>
  );
}
