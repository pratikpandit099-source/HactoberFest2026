const express = require('express');
const router = express.Router();
const chaosManager = require('../services/chaosManager');
const trafficGen = require('../services/trafficGen');

// GET /chaos/status - Get current active faults and events
router.get('/status', (req, res) => {
  res.json({
    chaos: chaosManager.getStatus(),
    traffic: trafficGen.getStatus()
  });
});

// POST /chaos/error-spike - Inject 5xx HTTP errors
router.post('/error-spike', (req, res) => {
  const { rate = 0.85, durationSeconds = 60 } = req.body || {};
  const status = chaosManager.triggerErrorSpike(parseFloat(rate), parseInt(durationSeconds, 10));
  res.json({ message: 'Error spike fault triggered', status });
});

router.post('/error-spike/stop', (req, res) => {
  chaosManager.stopErrorSpike();
  res.json({ message: 'Error spike stopped', status: chaosManager.getStatus() });
});

// POST /chaos/latency-spike - Inject p99 latency delay
router.post('/latency-spike', (req, res) => {
  const { delayMs = 2500, durationSeconds = 60 } = req.body || {};
  const status = chaosManager.triggerLatencySpike(parseInt(delayMs, 10), parseInt(durationSeconds, 10));
  res.json({ message: 'Latency spike fault triggered', status });
});

router.post('/latency-spike/stop', (req, res) => {
  chaosManager.stopLatencySpike();
  res.json({ message: 'Latency spike stopped', status: chaosManager.getStatus() });
});

// POST /chaos/cpu-spike - Spin CPU
router.post('/cpu-spike', (req, res) => {
  const { durationSeconds = 30 } = req.body || {};
  const status = chaosManager.triggerCpuSpike(parseInt(durationSeconds, 10));
  res.json({ message: 'CPU saturation burn triggered', status });
});

router.post('/cpu-spike/stop', (req, res) => {
  chaosManager.stopCpuSpike();
  res.json({ message: 'CPU burn stopped', status: chaosManager.getStatus() });
});

// POST /chaos/memory-leak - Predictive Memory Leak
router.post('/memory-leak', (req, res) => {
  const { chunkMb = 8, intervalMs = 1500 } = req.body || {};
  const status = chaosManager.triggerMemoryLeak(parseInt(chunkMb, 10), parseInt(intervalMs, 10));
  res.json({ message: 'Predictive memory leak triggered', status });
});

router.post('/memory-leak/stop', (req, res) => {
  chaosManager.stopMemoryLeak();
  res.json({ message: 'Memory leak stopped and buffers freed', status: chaosManager.getStatus() });
});

// POST /chaos/connection-exhaustion - Saturate DB pool
router.post('/connection-exhaustion', (req, res) => {
  const status = chaosManager.triggerDbExhaustion();
  res.json({ message: 'DB connection pool exhausted', status });
});

router.post('/connection-exhaustion/stop', (req, res) => {
  chaosManager.stopDbExhaustion();
  res.json({ message: 'DB connection pool restored', status: chaosManager.getStatus() });
});

// POST /chaos/novel-error-signature - Inject Loki log signature
router.post('/novel-error-signature', (req, res) => {
  const { type = 'payment_deadlock', count = 3 } = req.body || {};
  const result = chaosManager.injectNovelErrorSignatures(type, parseInt(count, 10));
  res.json({ message: 'Novel error signature emitted to Loki and logs', result });
});

// POST /chaos/deploy-regression - Deploy Guard test
router.post('/deploy-regression', (req, res) => {
  const { version = 'v1.4.3-regressed', commit = 'e94f12d' } = req.body || {};
  const status = chaosManager.triggerDeployRegression(version, commit);
  res.json({ message: 'Deploy regression simulated', status });
});

router.post('/deploy-regression/rollback', (req, res) => {
  chaosManager.stopDeployRegression();
  res.json({ message: 'Deploy regression rolled back', status: chaosManager.getStatus() });
});

// POST /chaos/reset - Restore everything to baseline
router.post('/reset', (req, res) => {
  const status = chaosManager.resetAll();
  res.json({ message: 'All chaos simulations cleared. System restored to baseline.', status });
});

// Traffic generator controls
router.post('/traffic/start', (req, res) => {
  const { rps = 8 } = req.body || {};
  trafficGen.start(parseInt(rps, 10));
  res.json({ message: 'Traffic generator started', traffic: trafficGen.getStatus() });
});

router.post('/traffic/stop', (req, res) => {
  trafficGen.stop();
  res.json({ message: 'Traffic generator stopped', traffic: trafficGen.getStatus() });
});

// Automated Chaos Test Scenario
router.post('/scenario/full-cycle', (req, res) => {
  trafficGen.start(10);
  chaosManager.resetAll();

  res.json({
    message: 'Automated 90-second Chaos Test Scenario initiated in background.',
    timeline: [
      { at: 'T+0s', action: 'Reset baseline + steady traffic at 10 RPS' },
      { at: 'T+10s', action: 'Inject HTTP 5xx Error Spike (SEV1 RED Error)' },
      { at: 'T+30s', action: 'Stop Error Spike (Recovery)' },
      { at: 'T+40s', action: 'Inject Latency Spike 3000ms (SEV2 RED Duration)' },
      { at: 'T+60s', action: 'Stop Latency Spike (Recovery)' },
      { at: 'T+70s', action: 'Start Predictive Memory Leak (predict_linear)' },
      { at: 'T+90s', action: 'Full Reset to baseline' }
    ]
  });

  // Execute scenario asynchronously
  setTimeout(() => chaosManager.triggerErrorSpike(0.85, 20), 10000);
  setTimeout(() => chaosManager.triggerLatencySpike(3000, 20), 40000);
  setTimeout(() => chaosManager.triggerMemoryLeak(10, 1000), 70000);
  setTimeout(() => chaosManager.resetAll(), 90000);
});

module.exports = router;
