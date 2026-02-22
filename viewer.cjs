#!/usr/bin/env node
// UTXO Organism (Self-Funding) Viewer — port 3005
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const PORT = 3005;
const LINEAGE_PATH = path.join(__dirname, 'lineage.json');
const STATE_PATH = path.join(__dirname, 'organism-state.json');
const SPAWN_TXID = '83c1a61f28accc0addd3652a3bc40bfe44a7c92cd1230fa6f6692ed0e5c31c6d';
const REWARD = 1000;
const FEE = 500;
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

  const rows = [...lineage].reverse().map(e => {
    const txShort = e.txid.slice(0, 12);
    const claimerDisplay = e.claimer === 'spawn'
      ? '<span class="spawn">🥚 spawn</span>'
      : `<a href="https://whatsonchain.com/address/${e.claimer}" target="_blank">${e.claimer.slice(0, 14)}…</a>`;
    const timeDisplay = e.blockTime
      ? new Date(e.blockTime).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
      : '<span class="mempool">mempool</span>';
    const statusIcon = e.alive ? '🟢' : '⬛';
    const rewardStr = e.reward ? `<span class="reward">+${e.reward.toLocaleString()}</span>` : '';
    const feeStr = e.fee ? `<span class="fee">${e.fee}</span>` : '';
    return `<tr class="${e.alive ? 'alive' : ''}">
      <td>${statusIcon} ${e.generation}</td>
      <td><a href="https://whatsonchain.com/tx/${e.txid}" target="_blank">${txShort}…</a></td>
      <td class="sats">${e.balance.toLocaleString()}</td>
      <td>${rewardStr}</td>
      <td>${feeStr}</td>
      <td>${claimerDisplay}</td>
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
  body { background: #0a0a0f; color: #ddd; font-family: 'SF Mono', 'Fira Code', 'Courier New', monospace; padding: 24px; min-height: 100vh; }
  .container { max-width: 900px; margin: 0 auto; }
  h1 { font-size: 28px; margin-bottom: 4px; color: #00ff88; }
  .subtitle { color: #666; font-size: 13px; margin-bottom: 8px; }
  .badge { display: inline-block; background: #1a2a1a; border: 1px solid #00ff8844; color: #00ff88; font-size: 11px; padding: 2px 8px; border-radius: 12px; margin-bottom: 24px; }
  .badge.dead { background: #2a1a1a; border-color: #ff444444; color: #ff4444; }
  .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; margin-bottom: 24px; }
  .stat { background: #111; border: 1px solid #222; border-radius: 8px; padding: 14px; }
  .stat-label { color: #555; font-size: 10px; text-transform: uppercase; letter-spacing: 1px; }
  .stat-value { font-size: 22px; font-weight: bold; margin-top: 4px; }
  .green { color: #00ff88; }
  .gold { color: #ffaa00; }
  .blue { color: #88aaff; }
  .red { color: #ff4444; }
  .cyan { color: #00ddff; }
  .bar-container { background: #1a1a2e; border-radius: 4px; height: 10px; margin: 16px 0; overflow: hidden; }
  .bar-fill { height: 100%; background: linear-gradient(90deg, #ff4444 0%, #ffaa00 40%, #00ff88 100%); border-radius: 4px; transition: width 0.5s; }
  .bar-label { display: flex; justify-content: space-between; font-size: 11px; color: #666; margin-bottom: 4px; }
  table { width: 100%; border-collapse: collapse; margin-top: 12px; }
  th { text-align: left; color: #555; font-size: 10px; text-transform: uppercase; letter-spacing: 1px; padding: 8px; border-bottom: 1px solid #222; }
  td { padding: 7px 8px; border-bottom: 1px solid #111; font-size: 12px; }
  tr.alive { background: #0a1a0f; }
  tr:hover { background: #1a1a2e; }
  a { color: #88aaff; text-decoration: none; }
  a:hover { text-decoration: underline; }
  .sats { color: #ffaa00; text-align: right; }
  .reward { color: #00ff88; }
  .fee { color: #ff6644; font-size: 11px; }
  .spawn { color: #00ff88; }
  .mempool { color: #ff8800; font-style: italic; }
  .section-title { color: #555; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; margin-top: 28px; margin-bottom: 8px; }
  .how-it-works { color: #777; font-size: 12px; line-height: 1.8; margin-top: 8px; background: #111; border: 1px solid #1a1a2e; border-radius: 8px; padding: 16px; }
  .how-it-works b { color: #aaa; }
  .footer { margin-top: 32px; color: #333; font-size: 11px; text-align: center; }
  .pulse { animation: pulse 2s ease-in-out infinite; }
  @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
</style>
</head>
<body>
<div class="container">
  <h1>🧬 UTXO Organism</h1>
  <div class="subtitle">Self-funding covenant on Bitcoin SV — claimers pay nothing</div>
  <div class="badge${isAlive ? '' : ' dead'}">${isAlive ? '● ALIVE' : '● DEAD'} · Self-Funding</div>

  <div class="stats">
    <div class="stat">
      <div class="stat-label">Generation</div>
      <div class="stat-value blue">${living ? living.generation : '—'}</div>
    </div>
    <div class="stat">
      <div class="stat-label">Balance</div>
      <div class="stat-value gold">${isAlive ? living.balance.toLocaleString() : '0'}</div>
    </div>
    <div class="stat">
      <div class="stat-label">Gens Left</div>
      <div class="stat-value ${gensLeft < 10 ? 'red' : 'green'}">${gensLeft}</div>
    </div>
    <div class="stat">
      <div class="stat-label">Claims</div>
      <div class="stat-value cyan">${totalClaims}</div>
    </div>
    <div class="stat">
      <div class="stat-label">Claimers</div>
      <div class="stat-value cyan">${uniqueClaimers.length}</div>
    </div>
    <div class="stat">
      <div class="stat-label">Rewards Paid</div>
      <div class="stat-value green">${totalRewards.toLocaleString()}</div>
    </div>
  </div>

  <div class="bar-label"><span>Energy · ${REWARD.toLocaleString()} reward + ${FEE} fee per claim</span><span>${lifePct}%</span></div>
  <div class="bar-container"><div class="bar-fill" style="width:${lifePct}%"></div></div>

  <div class="section-title">Lineage</div>
  <table>
    <tr><th>Gen</th><th>TX</th><th style="text-align:right">Balance</th><th>Reward</th><th>Fee</th><th>Claimer</th><th>Time</th></tr>
    ${rows}
  </table>

  <div class="section-title" style="margin-top:28px">How It Works</div>
  <div class="how-it-works">
    This organism is a <b>single UTXO</b> locked to an sCrypt smart contract on BSV.
    <b>Anyone</b> can claim it — the contract verifies the spending transaction recreates the organism
    with the same script, less ${(REWARD + FEE).toLocaleString()} sats, and an incremented generation counter.<br><br>
    The claimer receives <b>${REWARD.toLocaleString()} sats</b> as a reward. The organism pays its own
    <b>${FEE} sat miner fee</b> — claimers need zero BSV to participate.<br><br>
    When balance drops below ${DUST_LIMIT} sats, the organism dies. No server. No owner. Just script.
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
