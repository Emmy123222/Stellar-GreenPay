const fs = require('fs');
const path = require('path');

const REPORT_PATH = path.join(process.cwd(), 'report.json');
const CONFIG_PATH = path.join(process.cwd(), 'zap-false-positives.json');

// Helper to load JSON safely
function loadJson(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }
  } catch (err) {
    console.error(`Error loading or parsing JSON file at ${filePath}:`, err.message);
  }
  return null;
}

function runTriage() {
  console.log('=== ZAP Dynamic Security Scan Triage ===');

  const report = loadJson(REPORT_PATH);
  if (!report) {
    console.error('Error: ZAP scan report.json not found or is invalid. Make sure ZAP scan completed and produced report.json.');
    process.exit(1);
  }

  const config = loadJson(CONFIG_PATH) || { ignored_alerts: [] };
  const ignoredRules = config.ignored_alerts || [];

  // Parse sites
  let sites = report.site || [];
  if (!Array.isArray(sites)) {
    sites = [sites];
  }

  let highAlertsCount = 0;
  let mediumAlertsCount = 0;
  let lowAlertsCount = 0;
  let infoAlertsCount = 0;

  const activeHighFindings = [];
  const triagedFindings = [];

  for (const site of sites) {
    let alerts = site.alerts || [];
    if (!Array.isArray(alerts)) {
      alerts = [alerts];
    }

    for (const alert of alerts) {
      const riskcode = alert.riskcode;
      const riskdesc = alert.riskdesc || '';
      const pluginId = alert.pluginid;
      const alertName = alert.alert;
      let instances = alert.instances || [];
      if (!Array.isArray(instances)) {
        instances = [instances];
      }

      // Track counts based on riskcode
      if (riskcode === '3') {
        highAlertsCount++;
      } else if (riskcode === '2') {
        mediumAlertsCount++;
      } else if (riskcode === '1') {
        lowAlertsCount++;
      } else if (riskcode === '0') {
        infoAlertsCount++;
      }

      // Check for High/Critical risk findings
      if (riskcode === '3') {
        for (const inst of instances) {
          const uri = inst.uri || '';
          
          // Check if this instance is ignored/whitelisted
          const isIgnored = ignoredRules.some(rule => {
            const pluginMatch = String(rule.pluginId) === String(pluginId);
            const urlMatch = !rule.url || uri.toLowerCase().includes(rule.url.toLowerCase());
            return pluginMatch && urlMatch;
          });

          const findingDetails = {
            pluginId,
            alert: alertName,
            uri,
            riskdesc,
            method: inst.method || 'N/A',
            param: inst.param || 'N/A'
          };

          if (isIgnored) {
            triagedFindings.push(findingDetails);
          } else {
            activeHighFindings.push(findingDetails);
          }
        }
      }
    }
  }

  console.log('\n--- Scan Summary ---');
  console.log(`Informational alerts: ${infoAlertsCount}`);
  console.log(`Low alerts:           ${lowAlertsCount}`);
  console.log(`Medium alerts:        ${mediumAlertsCount}`);
  console.log(`High alerts:          ${highAlertsCount}`);

  if (triagedFindings.length > 0) {
    console.log(`\n--- Triaged/Whitelisted High Findings (${triagedFindings.length}) ---`);
    for (const f of triagedFindings) {
      console.log(`[TRIAGED] ${f.alert} (Plugin ID: ${f.pluginId}) on URI: ${f.uri}`);
    }
  }

  if (activeHighFindings.length > 0) {
    console.error(`\n🔴 FAILED CI: Detected ${activeHighFindings.length} unhandled HIGH or CRITICAL security finding(s)!`);
    for (const f of activeHighFindings) {
      console.error(`\n- Finding:    ${f.alert}`);
      console.error(`  Plugin ID:  ${f.pluginId}`);
      console.error(`  Risk:       ${f.riskdesc}`);
      console.error(`  URI:        ${f.uri}`);
      console.error(`  Method:     ${f.method}`);
      if (f.param && f.param !== 'N/A') {
        console.error(`  Parameter:  ${f.param}`);
      }
    }
    console.error('\nTo resolve this:');
    console.error('1. Fix the underlying security vulnerability in the codebase (recommended).');
    console.error('2. Or if it is verified as a false positive, add it to zap-false-positives.json.');
    process.exit(1);
  }

  console.log('\n✅ CI SUCCESS: No unhandled High or Critical findings detected.');
  process.exit(0);
}

runTriage();
