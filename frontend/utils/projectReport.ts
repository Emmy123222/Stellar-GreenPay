import type { ClimateProject, ProjectUpdate } from "@/utils/types";
import { formatAmount, formatDate, formatXLM, formatCO2, progressPercent } from "@/utils/format";

export function generatePrintReportHtml(project: ClimateProject, updates: ProjectUpdate[]): string {
  const pct = progressPercent(project.raisedXLM, project.goalXLM);
  const reportDate = formatDate(new Date(), undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <title>${project.name} - Impact Report</title>
          <style>
            @media print {
              @page { margin: 0.75in; }
              body { margin: 0; }
            }
            
            * { box-sizing: border-box; }
            
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
              line-height: 1.6;
              color: #1a2e1a;
              max-width: 800px;
              margin: 0 auto;
              padding: 40px 20px;
              background: white;
            }
            
            .header {
              text-align: center;
              margin-bottom: 40px;
              padding-bottom: 30px;
              border-bottom: 3px solid #227239;
            }
            
            .logo {
              font-size: 48px;
              margin-bottom: 10px;
            }
            
            .header h1 {
              font-size: 28px;
              color: #227239;
              margin: 0 0 10px 0;
              font-weight: 700;
            }
            
            .header .subtitle {
              font-size: 14px;
              color: var(--text-secondary);
              text-transform: uppercase;
              letter-spacing: 2px;
              font-weight: 600;
            }
            
            .project-header {
              margin-bottom: 30px;
            }
            
            .project-title {
              font-size: 32px;
              color: #1a2e1a;
              margin: 0 0 10px 0;
              font-weight: 700;
            }
            
            .project-meta {
              display: flex;
              gap: 20px;
              flex-wrap: wrap;
              font-size: 14px;
              color: var(--text-secondary);
              margin-bottom: 20px;
            }
            
            .project-meta span {
              display: inline-flex;
              align-items: center;
              gap: 5px;
            }
            
            .badges {
              display: flex;
              gap: 10px;
              flex-wrap: wrap;
              margin-bottom: 20px;
            }
            
            .badge {
              display: inline-block;
              padding: 6px 12px;
              border-radius: 20px;
              font-size: 12px;
              font-weight: 600;
              border: 2px solid;
            }
            
            .badge-verified {
              background: #e8f5e9;
              color: #2e7d32;
              border-color: #4caf50;
            }
            
            .badge-funded {
              background: #e8f5e9;
              color: #1b5e20;
              border-color: #4caf50;
            }
            
            .badge-category {
              background: #f0f7f0;
              color: #227239;
              border-color: #c8dfc8;
            }
            
            .section {
              margin-bottom: 30px;
              page-break-inside: avoid;
            }
            
            .section-title {
              font-size: 20px;
              color: #227239;
              margin: 0 0 15px 0;
              font-weight: 700;
              border-bottom: 2px solid #e8f3e8;
              padding-bottom: 8px;
            }
            
            .description {
              font-size: 15px;
              line-height: 1.8;
              color: #1a2e1a;
              white-space: pre-wrap;
            }
            
            .stats-grid {
              display: grid;
              grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
              gap: 20px;
              margin-bottom: 30px;
            }
            
            .stat-card {
              background: #f0f7f0;
              border: 2px solid #c8dfc8;
              border-radius: 12px;
              padding: 20px;
              text-align: center;
            }
            
            .stat-icon {
              font-size: 32px;
              margin-bottom: 8px;
            }
            
            .stat-value {
              font-size: 24px;
              font-weight: 700;
              color: #227239;
              margin-bottom: 5px;
            }
            
            .stat-label {
              font-size: 13px;
              color: var(--text-secondary);
              text-transform: uppercase;
              letter-spacing: 1px;
              font-weight: 600;
            }
            
            .progress-section {
              background: #f0f7f0;
              border: 2px solid #c8dfc8;
              border-radius: 12px;
              padding: 25px;
              margin-bottom: 30px;
            }
            
            .progress-header {
              display: flex;
              justify-content: space-between;
              margin-bottom: 12px;
              font-size: 14px;
              font-weight: 600;
            }
            
            .progress-bar {
              height: 24px;
              background: #c8dfc8;
              border-radius: 12px;
              overflow: hidden;
              position: relative;
            }
            
            .progress-fill {
              height: 100%;
              background: linear-gradient(90deg, #227239, #4caf70);
              border-radius: 12px;
              display: flex;
              align-items: center;
              justify-content: center;
              color: white;
              font-weight: 700;
              font-size: 13px;
            }
            
            .updates-list {
              list-style: none;
              padding: 0;
              margin: 0;
            }
            
            .update-item {
              padding: 15px 0;
              border-bottom: 1px solid #e8f3e8;
            }
            
            .update-item:last-child {
              border-bottom: none;
            }
            
            .update-title {
              font-weight: 600;
              color: #1a2e1a;
              margin-bottom: 5px;
            }
            
             .update-date {
               font-size: 12px;
               color: var(--text-tertiary);
               margin-bottom: 8px;
             }
            
            .update-body {
              font-size: 14px;
              color: var(--text-secondary);
              line-height: 1.6;
            }
            
             .footer {
               margin-top: 50px;
               padding-top: 30px;
               border-top: 2px solid #e8f3e8;
               text-align: center;
               font-size: 12px;
               color: var(--text-tertiary);
             }
            
            .footer-logo {
              font-size: 24px;
              margin-bottom: 10px;
            }
            
            .wallet-address {
              font-family: 'Courier New', monospace;
              background: #f0f7f0;
              padding: 8px 12px;
              border-radius: 6px;
              font-size: 11px;
              color: #227239;
              border: 1px solid #c8dfc8;
              word-break: break-all;
            }
            
            @media print {
              body { font-size: 12pt; }
              .no-print { display: none; }
            }
          </style>
        </head>
        <body>
          <div class="header">
            <div class="logo">🌱</div>
            <h1>Stellar GreenPay</h1>
            <div class="subtitle">Project Impact Report</div>
          </div>
          
          <div class="project-header">
            <h2 class="project-title">${project.name}</h2>
            <div class="project-meta">
              <span>📍 ${project.location}</span>
              <span>📅 Report Date: ${reportDate}</span>
            </div>
            <div class="badges">
              ${project.verified ? '<span class="badge badge-verified">✓ Verified Project</span>' : ""}
              ${pct >= 100 ? '<span class="badge badge-funded">✅ Fully Funded</span>' : ""}
              <span class="badge badge-category">${project.category}</span>
            </div>
          </div>
          
          <div class="section">
            <h3 class="section-title">Project Overview</h3>
            <div class="description">${project.description}</div>
          </div>
          
          <div class="section">
            <h3 class="section-title">Impact Metrics</h3>
            <div class="stats-grid">
              <div class="stat-card">
                <div class="stat-icon">💰</div>
                <div class="stat-value">${formatXLM(project.raisedXLM)}</div>
                <div class="stat-label">Total Raised</div>
              </div>
              <div class="stat-card">
                <div class="stat-icon">🎯</div>
                <div class="stat-value">${formatXLM(project.goalXLM)}</div>
                <div class="stat-label">Funding Goal</div>
              </div>
              <div class="stat-card">
                <div class="stat-icon">👥</div>
                <div class="stat-value">${formatAmount(project.donorCount, 0)}</div>
                <div class="stat-label">Total Donors</div>
              </div>
              <div class="stat-card">
                <div class="stat-icon">♻️</div>
                <div class="stat-value">${formatCO2(project.co2OffsetKg)}</div>
                <div class="stat-label">CO₂ Offset</div>
              </div>
            </div>
          </div>
          
          <div class="section">
            <h3 class="section-title">Funding Progress</h3>
            <div class="progress-section">
              <div class="progress-header">
                <span>${formatXLM(project.raisedXLM)} raised</span>
                <span>${pct}% of goal</span>
              </div>
              <div class="progress-bar">
                <div class="progress-fill" style="width: ${Math.min(pct, 100)}%">
                  ${pct >= 100 ? "Goal Reached!" : `${pct}%`}
                </div>
              </div>
            </div>
          </div>
          
          ${
            updates.length > 0
              ? `
          <div class="section">
            <h3 class="section-title">Recent Project Updates</h3>
            <ul class="updates-list">
              ${updates
                .slice(0, 5)
                .map(
                  (update) => `
                <li class="update-item">
                  <div class="update-title">${update.title}</div>
                  <div class="update-date">${formatDate(update.createdAt)}</div>
                  <div class="update-body">${update.body}</div>
                </li>
              `,
                )
                .join("")}
            </ul>
          </div>
          `
              : ""
          }
          
          <div class="section">
            <h3 class="section-title">Project Wallet</h3>
            <p style="margin-bottom: 10px; font-size: 14px; color: var(--text-secondary);">
              All donations are sent directly to this Stellar blockchain address:
            </p>
            <div class="wallet-address">${project.walletAddress}</div>
          </div>
          
          <div class="footer">
            <div class="footer-logo">🌍</div>
            <p>
              <strong>Stellar GreenPay</strong><br>
              Blockchain-powered climate finance<br>
              Open Source • Built on Stellar • Powered by Soroban
            </p>
            <p style="margin-top: 15px;">
              Learn more at stellar-greenpay.org
            </p>
          </div>
        </body>
      </html>
    `;
}

export function printProjectReport(project: ClimateProject, updates: ProjectUpdate[]): void {
  const printContent = generatePrintReportHtml(project, updates);
  const printWindow = window.open("", "_blank");
  if (printWindow) {
    printWindow.document.write(printContent);
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => {
      printWindow.print();
    }, 250);
  }
}
