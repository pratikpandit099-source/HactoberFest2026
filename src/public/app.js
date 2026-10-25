// Active Incident Banner & Countdown State
let currentCountdownTimer = null;
let countdownRemainingSeconds = 0;
let totalCountdownDuration = 60;
let currentActiveFaultKey = null;

// Fetch status and render
async function fetchStatus() {
  try {
    const res = await fetch('/chaos/status');
    if (!res.ok) return;
    const data = await res.json();
    renderStatus(data);
  } catch (err) {
    console.error('Status fetch error:', err);
  }
}

function renderStatus(data) {
  const { chaos, traffic } = data;
  const faults = chaos.faults;

  // Active faults count
  let activeCount = 0;
  const activeNames = [];
  if (faults.errorSpike) { activeCount++; activeNames.push('5xx Errors'); }
  if (faults.latencySpike) { activeCount++; activeNames.push('High Latency'); }
  if (faults.cpuSpike) { activeCount++; activeNames.push('CPU Burn'); }
  if (faults.memoryLeak) { activeCount++; activeNames.push(`Memory Leak (${faults.memoryLeak.allocatedMb}MB)`); }
  if (faults.dbExhaustion) { activeCount++; activeNames.push('DB Exhausted'); }
  if (faults.deployRegression) { activeCount++; activeNames.push('Deploy Regression'); }

  // Header status badge
  const badge = document.getElementById('system-badge');
  if (activeCount > 0) {
    badge.className = 'px-2.5 py-0.5 text-xs font-semibold rounded-full bg-rose-500/10 text-rose-400 border border-rose-500/20 flex items-center gap-1.5';
    badge.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-rose-400 animate-ping"></span> ${activeCount} INCIDENT${activeCount > 1 ? 'S' : ''} ACTIVE`;
  } else {
    badge.className = 'px-2.5 py-0.5 text-xs font-semibold rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1.5';
    badge.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span> BASELINE HEALTHY';
  }

  // Update Active Incident Banner
  updateIncidentBanner(faults, activeCount);

  // Update Card Glowing Rings based on active state
  highlightActiveCards(faults);

  // Top status cards
  document.getElementById('stat-traffic-rps').innerText = traffic.currentRps || 0;
  document.getElementById('stat-traffic-totals').innerText = `Total: ${traffic.totalRequests.toLocaleString()} (${traffic.successful.toLocaleString()} ok / ${traffic.failed.toLocaleString()} err)`;
  document.getElementById('traffic-toggle-btn').innerText = traffic.running ? 'Pause' : 'Start';

  document.getElementById('stat-faults-count').innerText = activeCount;
  document.getElementById('stat-faults-summary').innerText = activeCount > 0 ? activeNames.join(', ') : 'None (healthy)';

  const dbPoolVal = faults.dbExhaustion ? '20 / 20' : '3 / 20';
  document.getElementById('stat-db-pool').innerText = dbPoolVal;
  const dbStatus = document.getElementById('stat-db-status');
  if (faults.dbExhaustion) {
    dbStatus.className = 'text-xs text-rose-400 mt-1 font-semibold';
    dbStatus.innerText = 'Exhausted! (503s queuing)';
  } else {
    dbStatus.className = 'text-xs text-emerald-400 mt-1';
    dbStatus.innerText = 'Normal headroom';
  }

  document.getElementById('stat-version').innerText = chaos.version;
  document.getElementById('stat-commit').innerText = faults.deployRegression
    ? `Commit: ${faults.deployRegression.commit} (REGRESSED)`
    : 'Commit: a1b2c3d (stable)';

  // Events Table
  const tbody = document.getElementById('events-tbody');
  if (chaos.recentEvents && chaos.recentEvents.length > 0) {
    tbody.innerHTML = chaos.recentEvents.map(evt => {
      let badgeColor = 'text-slate-400 bg-slate-800';
      if (evt.type.includes('TRIGGERED') || evt.type.includes('EXHAUSTED') || evt.type.includes('ACTIVE')) {
        badgeColor = 'text-rose-400 bg-rose-500/10 border border-rose-500/20';
      } else if (evt.type.includes('RESOLVED') || evt.type.includes('RESTORED') || evt.type.includes('RESET')) {
        badgeColor = 'text-emerald-400 bg-emerald-500/10 border border-emerald-500/20';
      }
      return `
        <tr class="hover:bg-slate-800/40 transition">
          <td class="py-2 px-3 text-slate-400 whitespace-nowrap">${new Date(evt.timestamp).toLocaleTimeString()}</td>
          <td class="py-2 px-3 whitespace-nowrap"><span class="px-2 py-0.5 rounded text-[11px] font-semibold ${badgeColor}">${evt.type}</span></td>
          <td class="py-2 px-3 text-slate-300">${evt.description}</td>
        </tr>
      `;
    }).join('');
  }

  document.getElementById('last-updated-text').innerText = `Synced at ${new Date().toLocaleTimeString()}`;
}

// Update Active Banner & Progress Bar
function updateIncidentBanner(faults, activeCount) {
  const banner = document.getElementById('active-incident-banner');
  if (activeCount === 0) {
    banner.classList.add('hidden');
    if (currentCountdownTimer) {
      clearInterval(currentCountdownTimer);
      currentCountdownTimer = null;
    }
    currentActiveFaultKey = null;
    return;
  }

  banner.classList.remove('hidden');

  let title = 'Active Incident in Progress';
  let sev = 'SEV1 INCIDENT';
  let sevBg = 'bg-rose-500';
  let endpoint = '/chaos';
  let payloadStr = '{}';
  let desc = 'Microservice anomaly actively firing telemetry to Prometheus & Loki.';
  let faultKey = '';

  if (faults.errorSpike) {
    title = 'HTTP 5xx Error Spike Active';
    sev = 'SEV1 RED ERROR';
    sevBg = 'bg-rose-600';
    endpoint = 'POST /chaos/error-spike';
    payloadStr = JSON.stringify({ rate: faults.errorSpike.rate, durationSeconds: 60 });
    desc = `Simulating ${(faults.errorSpike.rate * 100).toFixed(0)}% 5xx server failures &bull; Tripping PromQL: sum(rate(http_requests_total{status_code=~"5.."}[1m])) > 5%`;
    faultKey = 'errorSpike';
  } else if (faults.latencySpike) {
    title = 'P99 Latency Delay Injected';
    sev = 'SEV2 RED DURATION';
    sevBg = 'bg-amber-600';
    endpoint = 'POST /chaos/latency-spike';
    payloadStr = JSON.stringify({ delayMs: faults.latencySpike.delayMs, durationSeconds: 60 });
    desc = `Adding ${faults.latencySpike.delayMs}ms artificial delay &bull; Tripping PromQL: histogram_quantile(0.99, ...) > 1.0s`;
    faultKey = 'latencySpike';
  } else if (faults.memoryLeak) {
    title = 'Predictive Memory Leak Growing';
    sev = 'PREDICTIVE SATURATION';
    sevBg = 'bg-purple-600';
    endpoint = 'POST /chaos/memory-leak';
    payloadStr = JSON.stringify({ allocatedMb: faults.memoryLeak.allocatedMb });
    desc = `Leaked ${faults.memoryLeak.allocatedMb}MB into heap &bull; Tripping PromQL: predict_linear(memory_leak_gauge_bytes[1m], 300) > 80MB`;
    faultKey = 'memoryLeak';
  } else if (faults.dbExhaustion) {
    title = 'PostgreSQL Connection Pool Saturated';
    sev = 'SEV1 SATURATION';
    sevBg = 'bg-cyan-600';
    endpoint = 'POST /chaos/connection-exhaustion';
    payloadStr = '{"active": 20, "max": 20}';
    desc = 'All 20/20 DB pool slots occupied &bull; Requests timing out with 503 DatabaseConnectionTimeout';
    faultKey = 'dbExhaustion';
  } else if (faults.deployRegression) {
    title = 'Deploy Guard: Post-Deploy Regression Active';
    sev = 'SEV1 DEPLOY GUARD';
    sevBg = 'bg-pink-600';
    endpoint = 'POST /chaos/deploy-regression';
    payloadStr = JSON.stringify(faults.deployRegression);
    desc = `Regression on ${faults.deployRegression.version} (${faults.deployRegression.commit}) &bull; Schema mismatch breaking checkout`;
    faultKey = 'deployRegression';
  } else if (faults.cpuSpike) {
    title = 'CPU Saturation Stress Burn Active';
    sev = 'SEV2 SATURATION';
    sevBg = 'bg-orange-600';
    endpoint = 'POST /chaos/cpu-spike';
    payloadStr = '{"durationSeconds": 30}';
    desc = 'Running computational loops &bull; Tripping PromQL: rate(process_cpu_user_seconds_total[1m]) * 100 > 60%';
    faultKey = 'cpuSpike';
  }

  document.getElementById('banner-title').innerText = title;
  document.getElementById('banner-sev-badge').innerText = sev;
  document.getElementById('banner-sev-badge').className = `px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider text-white ${sevBg}`;
  document.getElementById('banner-endpoint').innerText = endpoint;
  document.getElementById('banner-payload').innerText = payloadStr;
  document.getElementById('banner-description').innerHTML = desc;

  currentActiveFaultKey = faultKey;
}

// Start Countdown Progress Bar
function startBannerCountdown(seconds, faultKey) {
  if (currentCountdownTimer) clearInterval(currentCountdownTimer);

  totalCountdownDuration = seconds;
  countdownRemainingSeconds = seconds;

  const timerText = document.getElementById('banner-timer-text');
  const progressBar = document.getElementById('banner-progress-bar');

  timerText.innerText = `${countdownRemainingSeconds}s remaining`;
  progressBar.style.width = '100%';

  currentCountdownTimer = setInterval(() => {
    countdownRemainingSeconds--;
    if (countdownRemainingSeconds <= 0) {
      clearInterval(currentCountdownTimer);
      currentCountdownTimer = null;
      timerText.innerText = 'Resolving...';
      progressBar.style.width = '0%';
    } else {
      timerText.innerText = `${countdownRemainingSeconds}s remaining`;
      const pct = (countdownRemainingSeconds / totalCountdownDuration) * 100;
      progressBar.style.width = `${pct}%`;
    }
  }, 1000);
}

// Stop current active incident
function stopCurrentIncident() {
  if (currentActiveFaultKey === 'errorSpike') stopErrorSpike();
  else if (currentActiveFaultKey === 'latencySpike') stopLatencySpike();
  else if (currentActiveFaultKey === 'memoryLeak') stopMemoryLeak();
  else if (currentActiveFaultKey === 'cpuSpike') stopCpuSpike();
  else if (currentActiveFaultKey === 'dbExhaustion') stopDbExhaustion();
  else if (currentActiveFaultKey === 'deployRegression') rollbackDeployRegression();
  else resetSystem();
}

// Card active glow highlights
function highlightActiveCards(faults) {
  const toggle = (id, active, colorClass) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (active) {
      el.classList.add(colorClass, 'ring-2', 'ring-offset-2', 'ring-offset-slate-950');
    } else {
      el.classList.remove(colorClass, 'ring-2', 'ring-offset-2', 'ring-offset-slate-950');
    }
  };

  toggle('card-error-spike', !!faults.errorSpike, 'ring-rose-500');
  toggle('card-latency-spike', !!faults.latencySpike, 'ring-amber-500');
  toggle('card-memory-leak', !!faults.memoryLeak, 'ring-purple-500');
  toggle('card-cpu-spike', !!faults.cpuSpike, 'ring-orange-500');
  toggle('card-db-exhaustion', !!faults.dbExhaustion, 'ring-cyan-500');
  toggle('card-deploy-guard', !!faults.deployRegression, 'ring-pink-500');
}

// Sleek Floating Toast Notification
function showToast({ title, message, endpoint, payload, type = 'danger' }) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = 'toast-enter pointer-events-auto p-4 rounded-xl bg-slate-900 border border-slate-700 shadow-2xl flex flex-col gap-2 relative overflow-hidden backdrop-blur';

  let borderColor = 'border-rose-500/50';
  let iconClass = 'fa-solid fa-fire text-rose-400';
  let badgeText = 'INCIDENT SENT';
  let badgeColor = 'bg-rose-500/20 text-rose-300 border-rose-500/30';

  if (type === 'success') {
    borderColor = 'border-emerald-500/50';
    iconClass = 'fa-solid fa-circle-check text-emerald-400';
    badgeText = 'BASELINE RESTORED';
    badgeColor = 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30';
  } else if (type === 'warning') {
    borderColor = 'border-amber-500/50';
    iconClass = 'fa-solid fa-stopwatch text-amber-400';
    badgeText = 'TELEMETRY SPURT';
    badgeColor = 'bg-amber-500/20 text-amber-300 border-amber-500/30';
  } else if (type === 'info') {
    borderColor = 'border-indigo-500/50';
    iconClass = 'fa-solid fa-fingerprint text-indigo-400';
    badgeText = 'LOKI SIGNATURE';
    badgeColor = 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30';
  }

  toast.classList.add(borderColor);

  toast.innerHTML = `
    <div class="flex items-start justify-between gap-3">
      <div class="flex items-center gap-2">
        <i class="${iconClass}"></i>
        <span class="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border ${badgeColor}">${badgeText}</span>
      </div>
      <button onclick="this.closest('.toast-enter').remove()" class="text-slate-400 hover:text-white text-xs">
        <i class="fa-solid fa-xmark"></i>
      </button>
    </div>
    <div>
      <h4 class="text-xs font-bold text-white">${title}</h4>
      <p class="text-[11px] text-slate-300 mt-0.5">${message}</p>
    </div>
    <div class="p-2 bg-slate-950/80 rounded border border-slate-800 font-mono text-[10px] text-slate-400 space-y-1">
      <div class="text-indigo-300"><span class="text-slate-500">Target:</span> ${endpoint}</div>
      ${payload ? `<div class="truncate"><span class="text-slate-500">Payload:</span> ${JSON.stringify(payload)}</div>` : ''}
    </div>
    <!-- Progress line -->
    <div class="h-0.5 bg-slate-800 rounded-full overflow-hidden mt-1">
      <div class="h-full bg-gradient-to-r from-indigo-500 to-rose-500 animate-pulse w-full"></div>
    </div>
  `;

  container.appendChild(toast);

  // Trigger enter animation
  setTimeout(() => {
    toast.classList.add('toast-show');
  }, 10);

  // Auto dismiss after 5.5s
  setTimeout(() => {
    toast.classList.remove('toast-show');
    toast.classList.add('toast-exit');
    setTimeout(() => toast.remove(), 300);
  }, 5500);
}

// Action Handlers with Button Spinners & Feedback
async function postApi(path, body = {}, buttonId = null) {
  let originalBtnHtml = null;
  const btn = buttonId ? document.getElementById(buttonId) : null;

  if (btn) {
    originalBtnHtml = btn.innerHTML;
    btn.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> <span>Sending...</span>`;
    btn.disabled = true;
  }

  try {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const result = await res.json();
    fetchStatus();
    return result;
  } catch (err) {
    console.error(`Error posting to ${path}:`, err);
  } finally {
    if (btn && originalBtnHtml) {
      btn.innerHTML = originalBtnHtml;
      btn.disabled = false;
    }
  }
}

function injectErrorSpike() {
  const payload = { rate: 0.85, durationSeconds: 60 };
  startBannerCountdown(60, 'errorSpike');
  showToast({
    title: 'HTTP 5xx Error Spike Sent',
    message: 'Triggered 85% simulated failure rate. PromQL RED error rate alert will fire.',
    endpoint: 'POST /chaos/error-spike',
    payload,
    type: 'danger'
  });
  postApi('/chaos/error-spike', payload, 'btn-inject-errors');
}

function stopErrorSpike() {
  showToast({ title: '5xx Error Spike Stopped', message: 'Traffic returned to baseline (200 OK).', endpoint: 'POST /chaos/error-spike/stop', type: 'success' });
  postApi('/chaos/error-spike/stop');
}

function injectLatencySpike() {
  const payload = { delayMs: 2800, durationSeconds: 60 };
  startBannerCountdown(60, 'latencySpike');
  showToast({
    title: 'P99 Latency Spike Sent',
    message: 'Added 2800ms artificial delay. Tripping PromQL P99 duration threshold (>1.0s).',
    endpoint: 'POST /chaos/latency-spike',
    payload,
    type: 'warning'
  });
  postApi('/chaos/latency-spike', payload, 'btn-inject-latency');
}

function stopLatencySpike() {
  showToast({ title: 'Latency Delay Stopped', message: 'Request durations returned to normal (<50ms).', endpoint: 'POST /chaos/latency-spike/stop', type: 'success' });
  postApi('/chaos/latency-spike/stop');
}

function injectMemoryLeak() {
  const payload = { chunkMb: 8, intervalMs: 1500 };
  startBannerCountdown(60, 'memoryLeak');
  showToast({
    title: 'Predictive Memory Leak Started',
    message: 'Allocating +8MB every 1.5s. PromQL predict_linear forecasts heap exhaustion in 5m.',
    endpoint: 'POST /chaos/memory-leak',
    payload,
    type: 'warning'
  });
  postApi('/chaos/memory-leak', payload, 'btn-inject-memory');
}

function stopMemoryLeak() {
  showToast({ title: 'Memory Leak Cleaned', message: 'Buffers cleared from heap memory.', endpoint: 'POST /chaos/memory-leak/stop', type: 'success' });
  postApi('/chaos/memory-leak/stop');
}

function injectCpuSpike() {
  const payload = { durationSeconds: 30 };
  startBannerCountdown(30, 'cpuSpike');
  showToast({
    title: 'CPU Saturation Burn Triggered',
    message: 'Running computational burn loops for 30s. Saturation CPU % will spike.',
    endpoint: 'POST /chaos/cpu-spike',
    payload,
    type: 'danger'
  });
  postApi('/chaos/cpu-spike', payload, 'btn-inject-cpu');
}

function stopCpuSpike() {
  showToast({ title: 'CPU Burn Stopped', message: 'CPU utilization returned to normal idle.', endpoint: 'POST /chaos/cpu-spike/stop', type: 'success' });
  postApi('/chaos/cpu-spike/stop');
}

function injectDbExhaustion() {
  showToast({
    title: 'DB Connection Pool Saturated',
    message: 'Allocated all 20/20 DB pool connections. Subsequent queries queue and throw 503s.',
    endpoint: 'POST /chaos/connection-exhaustion',
    payload: { connections: 20 },
    type: 'danger'
  });
  postApi('/chaos/connection-exhaustion', {}, 'btn-inject-db');
}

function stopDbExhaustion() {
  showToast({ title: 'DB Pool Released', message: 'Restored to healthy baseline (3/20 active).', endpoint: 'POST /chaos/connection-exhaustion/stop', type: 'success' });
  postApi('/chaos/connection-exhaustion/stop');
}

function injectNovelError(type = 'payment_deadlock') {
  const payload = { type, count: 3 };
  showToast({
    title: 'Novel Loki Error Signature Emitted',
    message: `Pushed unhandled ${type} stack trace to Loki to test LogQL pattern clustering.`,
    endpoint: 'POST /chaos/novel-error-signature',
    payload,
    type: 'info'
  });
  postApi('/chaos/novel-error-signature', payload, type === 'payment_deadlock' ? 'btn-inject-loki-deadlock' : 'btn-inject-loki-auth');
}

function injectDeployRegression() {
  const payload = { version: 'v1.4.3-regressed', commit: 'e94f12d' };
  showToast({
    title: 'Deploy Guard: Regression Simulated',
    message: 'Updated service version to v1.4.3-regressed (commit e94f12d) with broken checkout schema.',
    endpoint: 'POST /chaos/deploy-regression',
    payload,
    type: 'danger'
  });
  postApi('/chaos/deploy-regression', payload, 'btn-inject-deploy');
}

function rollbackDeployRegression() {
  showToast({ title: 'Deploy Guard: Rollback Complete', message: 'Rolled back to stable baseline v1.4.2 (commit a1b2c3d).', endpoint: 'POST /chaos/deploy-regression/rollback', type: 'success' });
  postApi('/chaos/deploy-regression/rollback');
}

function resetSystem() {
  showToast({
    title: 'System Baseline Restored',
    message: 'All active chaos faults cleared. All Prometheus metrics zeroed back to baseline.',
    endpoint: 'POST /chaos/reset',
    type: 'success'
  });
  postApi('/chaos/reset');
}

function toggleTraffic() {
  const btn = document.getElementById('traffic-toggle-btn');
  if (btn.innerText === 'Pause') {
    showToast({ title: 'Traffic Generator Paused', message: 'Stopped simulated HTTP requests.', endpoint: 'POST /chaos/traffic/stop', type: 'warning' });
    postApi('/chaos/traffic/stop');
  } else {
    showToast({ title: 'Traffic Generator Started', message: 'Simulating 8 RPS background traffic.', endpoint: 'POST /chaos/traffic/start', type: 'success' });
    postApi('/chaos/traffic/start', { rps: 8 });
  }
}

function runAutoScenario() {
  startBannerCountdown(90, 'scenario');
  showToast({
    title: 'Automated 90s Incident Cycle Started',
    message: 'Running baseline -> 5xx spike -> latency spike -> memory leak -> baseline recovery.',
    endpoint: 'POST /chaos/scenario/full-cycle',
    type: 'danger'
  });
  postApi('/chaos/scenario/full-cycle');
}

// Start polling
setInterval(fetchStatus, 1500);
fetchStatus();
