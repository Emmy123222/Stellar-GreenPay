const fs = require("fs");
const files = [
  "frontend/pages/index.tsx",
  "frontend/pages/projects/[id].tsx",
  "frontend/pages/donors/[publicKey].tsx",
  "frontend/components/ProjectCard.tsx",
  "frontend/components/DonationFeed.tsx",
  "frontend/components/ContributorTimeline.tsx",
  "frontend/components/LeaderboardTable.tsx",
  "frontend/components/DonationTicker.tsx",
  "frontend/components/MilestoneTracker.tsx",
  "frontend/components/ImpactCertificate.tsx",
  "frontend/components/EditProfileForm.tsx",
  "frontend/components/ToastNotification.tsx",
  "frontend/components/WalletConnect.tsx",
  "frontend/components/ProjectComparison.tsx",
  "frontend/components/MonthlyGivingSetup.tsx",
  "frontend/components/DonationGrowthChart.tsx",
  "frontend/components/DescriptionAccordion.tsx",
  "frontend/styles/globals.css",
];
const rx = /(text-forest-400|text-forest-300|#4caf70|#8aaa8a|#5a7a5a|#6a8a6a|#7a9b80|#4f6f4f)/g;
for (const f of files) {
  const s = fs.readFileSync(f, "utf8");
  const lines = s.split("\n");
  lines.forEach(function (l, i) {
    if (rx.test(l)) {
      rx.lastIndex = 0;
      console.log(f + ":" + (i + 1) + ": " + l.trim().slice(0, 140));
    }
  });
}
