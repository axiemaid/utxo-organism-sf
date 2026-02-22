#!/usr/bin/env node
// UTXO Organism (Self-Funding) Viewer — port 3005
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const PORT = 3005;
const LINEAGE_PATH = path.join(__dirname, 'lineage.json');
const STATE_PATH = path.join(__dirname, 'organism-state.json');
const SPAWN_TXID = '2f9f16d8d3523c867775bb07f9b6960e8fbcff92a90494f6c3e193c0545c1fed';
const REWARD = 1000;
const FEE = 3000;
const DUST_LIMIT = 546;
const INITIAL_FUNDING = 100000;

function loadLineage() {
  try { return JSON.parse(fs.readFileSync(LINEAGE_PATH, 'utf-8')); }
  catch { return []; }
}

function rescan() {
  try { execSync(`node ${path.join(__dirname, 'scanner.cjs')}`, { timeout: 30000, stdio: 'ignore' }); }
  catch {}
}
setInterval(rescan, 60000);

function renderHTML() {
  const lineage = loadLineage();
  const living = lineage.length > 0 ? lineage[lineage.length - 1] : null;
  const isAlive = living && living.alive;
  const gensLeft = isAlive ? Math.floor((living.balance - DUST_LIMIT) / (REWARD + FEE)) : 0;
  const lifePct = isAlive ? Math.round((living.balance / INITIAL_FUNDING) * 100) : 0;
  const totalClaims = lineage.filter(e => e.generation > 0).length;
  const uniqueClaimers = [...new Set(lineage.filter(e => e.claimer !== 'spawn').map(e => e.claimer))];
  const totalRewards = lineage.reduce((s, e) => s + (e.reward || 0), 0);
  const totalFees = lineage.reduce((s, e) => s + (e.fee || 0), 0);

  const rows = lineage.map(e => {
    const txShort = e.txid.slice(0, 12);
    const claimerDisplay = e.claimer === 'spawn'
      ? '<span class="spawn">🥚 spawn</span>'
      : `<a href="https://whatsonchain.com/address/${e.claimer}" target="_blank">${e.claimer.slice(0, 14)}…</a>`;
    const timeDisplay = e.blockTime
      ? new Date(e.blockTime).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
      : '<span class="mempool">mempool</span>';
    const statusIcon = e.alive ? '🟢' : '⬛';
    return `<tr class="${e.alive ? 'alive' : ''}">
      <td>${statusIcon} ${e.generation}</td>
      <td>${claimerDisplay}</td>
      <td class="sats">${e.balance.toLocaleString()}</td>
      <td><a href="https://whatsonchain.com/tx/${e.txid}" target="_blank">${txShort}…</a></td>
      <td>${timeDisplay}</td>
    </tr>`;
  }).join('\n');

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>🧬 UTXO Organism SF</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #0a0a0f; color: #ddd; font-family: 'SF Mono', 'Fira Code', monospace; padding: 24px; min-height: 100vh; }
  .container { max-width: 800px; margin: 0 auto; }
  h1 { font-size: 28px; margin-bottom: 4px; color: #00ff88; }
  .subtitle { color: #666; font-size: 13px; margin-bottom: 24px; }
  .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin-bottom: 24px; }
  .stat { background: #111; border: 1px solid #222; border-radius: 8px; padding: 16px; }
  .stat-label { color: #666; font-size: 11px; text-transform: uppercase; letter-spacing: 1px; }
  .stat-value { font-size: 24px; font-weight: bold; margin-top: 4px; }
  .stat-value.green { color: #00ff88; }
  .stat-value.gold { color: #ffaa00; }
  .stat-value.blue { color: #88aaff; }
  .stat-value.red { color: #ff4444; }
  .bar-container { background: #1a1a2e; border-radius: 4px; height: 8px; margin: 16px 0; overflow: hidden; }
  .bar-fill { height: 100%; background: linear-gradient(90deg, #ff4444, #ffaa00, #00ff88); border-radius: 4px; transition: width 0.5s; }
  .bar-label { display: flex; justify-content: space-between; font-size: 11px; color: #666; margin-bottom: 4px; }
  table { width: 100%; border-collapse: collapse; margin-top: 16px; }
  th { text-align: left; color: #666; font-size: 11px; text-transform: uppercase; letter-spacing: 1px; padding: 8px; border-bottom: 1px solid #222; }
  td { padding: 8px; border-bottom: 1px solid #111; font-size: 13px; }
  tr.alive { background: #0a1a0f; }
  tr:hover { background: #1a1a2e; }
  a { color: #88aaff; text-decoration: none; }
  a:hover { text-decoration: underline; }
  .sats { color: #ffaa00; text-align: right; }
  .spawn { color: #00ff88; }
  .mempool { color: #ff8800; font-style: italic; }
  .section-title { color: #666; font-size: 13px; text-transform: uppercase; letter-spacing: 1px; margin-top: 32px; margin-bottom: 8px; }
  .footer { margin-top: 32px; color: #333; font-size: 11px; text-align: center; }
  .pulse { animation: pulse 2s ease-in-out infinite; }
  @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
</style>
</head>
<body>
<div class="container">
  <h1>🧬 UTXO Organism</h1>
  <div class="subtitle">A self-propagating covenant on Bitcoin SV — no owner, no server, just script</div>

  <div class="stats">
    <div class="stat">
      <div class="stat-label">Status</div>
      <div class="stat-value green"><span class="pulse">●</span> ${isAlive ? 'Alive' : 'Dead'}</div>
    </div>
    <div class="stat">
      <div class="stat-label">Generation</div>
      <div class="stat-value blue">${living ? living.generation : '?'}</div>
    </div>
    <div class="stat">
      <div class="stat-label">Balance</div>
      <div class="stat-value gold">${isAlive ? living.balance.toLocaleString() : '?'} sats</div>
    </div>
    <div class="stat">
      <div class="stat-label">Generations Left</div>
      <div class="stat-value ${gensLeft < 10 ? 'red' : 'green'}">${gensLeft}</div>
    </div>
  </div>

  <div class="bar-label"><span>Energy · ${REWARD.toLocaleString()} reward + ${FEE} fee per claim</span><span>${lifePct}%</span></div>
  <div class="bar-container"><div class="bar-fill" style="width:${lifePct}%"></div></div>

  <div class="section-title">Lineage</div>
  <table>
    <tr><th>Gen</th><th>Claimer</th><th style="text-align:right">Balance</th><th>TX</th><th>Time</th></tr>
    ${rows}
  </table>

  <div class="section-title" style="margin-top:24px">How It Works</div>
  <div style="color:#888;font-size:12px;line-height:1.8;margin-top:8px">
    This organism is a single UTXO locked to an sCrypt smart contract on BSV.
    <b>Anyone</b> can claim it — the contract verifies the spending transaction recreates the organism
    with the same script, less ${(REWARD + FEE).toLocaleString()} sats, and an incremented generation counter.
    The claimer receives ${REWARD.toLocaleString()} sats as a reward. The miner fee of
    ${FEE} sats is also paid from the organism's balance — claimers need zero BSV to participate.
    When the balance drops below ${DUST_LIMIT} sats, the organism dies — no child is created.
  </div>

  <div class="footer">
    Auto-refreshes every 60s ·
    <a href="https://whatsonchain.com/tx/${SPAWN_TXID}" target="_blank">Spawn TX</a> ·
    <a href="https://github.com/axiemaid/utxo-organism-sf" target="_blank">GitHub</a>
  </div>
</div>
<script>setTimeout(() => location.reload(), 60000);</script>
</body>
</html>`;
}

const server = http.createServer((req, res) => {
  if (req.url === '/api/lineage') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify(loadLineage()));
  } else {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(renderHTML());
  }
});

server.listen(PORT, () => {
  console.log(`🧬 Self-funding organism viewer at http://localhost:${PORT}`);
  rescan();
});
