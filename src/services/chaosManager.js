const {
  memoryLeakGaugeBytes,
  dbConnectionPoolActive,
  deployRegressionActive,
  chaosFaultActive
} = require('../metrics');
const logger = require('../logger');
const config = require('../config');

class ChaosManager {
  constructor() {
    this.state = {
      errorSpike: { enabled: false, rate: 0.8, timer: null },
      latencySpike: { enabled: false, delayMs: 2500, timer: null },
      cpuSpike: { enabled: false, activeInterval: null, timer: null },
      memoryLeak: { enabled: false, interval: null, allocatedMb: 0 },
      dbExhaustion: { enabled: false },
      deployRegression: { enabled: false, version: 'v1.4.3-regressed', commit: 'e94f12d' },
    };

    this.leakedBuffers = [];
    this.recentIncidents = [];
  }

  // 1. Error Spike Injection (RED Metric: Errors)
  triggerErrorSpike(rate = 0.85, durationSeconds = 60) {
    this.state.errorSpike.enabled = true;
    this.state.errorSpike.rate = Math.min(Math.max(rate, 0.1), 1.0);
    chaosFaultActive.set({ fault_type: 'error_spike', service: config.serviceName }, 1);

    logger.warn(`[CHAOS LAB] Injected HTTP 5xx Error Spike: ${(this.state.errorSpike.rate * 100).toFixed(0)}% failure rate for ${durationSeconds}s`);
    this.recordIncidentEvent('ERROR_SPIKE_TRIGGERED', `Injected 5xx error rate at ${(this.state.errorSpike.rate * 100).toFixed(0)}%`);

    if (this.state.errorSpike.timer) clearTimeout(this.state.errorSpike.timer);
    if (durationSeconds > 0) {
      this.state.errorSpike.timer = setTimeout(() => {
        this.stopErrorSpike();
      }, durationSeconds * 1000);
    }

    return this.getStatus();
  }

  stopErrorSpike() {
    this.state.errorSpike.enabled = false;
    if (this.state.errorSpike.timer) clearTimeout(this.state.errorSpike.timer);
    this.state.errorSpike.timer = null;
    chaosFaultActive.set({ fault_type: 'error_spike', service: config.serviceName }, 0);
    logger.info('[CHAOS LAB] Stopped HTTP 5xx Error Spike. Returning to baseline.');
    this.recordIncidentEvent('ERROR_SPIKE_RESOLVED', 'Error spike stopped, traffic normalized.');
  }

  // 2. Latency Spike Injection (RED Metric: Duration)
  triggerLatencySpike(delayMs = 2500, durationSeconds = 60) {
    this.state.latencySpike.enabled = true;
    this.state.latencySpike.delayMs = delayMs;
    chaosFaultActive.set({ fault_type: 'latency_spike', service: config.serviceName }, 1);

    logger.warn(`[CHAOS LAB] Injected Latency Spike: ${delayMs}ms delay per request for ${durationSeconds}s`);
    this.recordIncidentEvent('LATENCY_SPIKE_TRIGGERED', `Artificial latency of ${delayMs}ms injected (spiking p99).`);

    if (this.state.latencySpike.timer) clearTimeout(this.state.latencySpike.timer);
    if (durationSeconds > 0) {
      this.state.latencySpike.timer = setTimeout(() => {
        this.stopLatencySpike();
      }, durationSeconds * 1000);
    }

    return this.getStatus();
  }

  stopLatencySpike() {
    this.state.latencySpike.enabled = false;
    if (this.state.latencySpike.timer) clearTimeout(this.state.latencySpike.timer);
    this.state.latencySpike.timer = null;
    chaosFaultActive.set({ fault_type: 'latency_spike', service: config.serviceName }, 0);
    logger.info('[CHAOS LAB] Stopped Latency Spike.');
    this.recordIncidentEvent('LATENCY_SPIKE_RESOLVED', 'Latency returned to normal baseline.');
  }

  // 3. CPU Saturation Spike (Saturation Metric)
  triggerCpuSpike(durationSeconds = 30) {
    this.state.cpuSpike.enabled = true;
    chaosFaultActive.set({ fault_type: 'cpu_spike', service: config.serviceName }, 1);
    logger.warn(`[CHAOS LAB] Triggered CPU saturation burn for ${durationSeconds}s`);
    this.recordIncidentEvent('CPU_SATURATION_TRIGGERED', `CPU intensive calculation active for ${durationSeconds}s.`);

    // Spin CPU in chunks to drive CPU % without freezing node event loop completely
    const burnCpu = () => {
      const start = Date.now();
      while (Date.now() - start < 180) {
        Math.sqrt(Math.random() * 1000000);
      }
    };

    burnCpu();
    this.state.cpuSpike.activeInterval = setInterval(burnCpu, 200);

    if (this.state.cpuSpike.timer) clearTimeout(this.state.cpuSpike.timer);
    this.state.cpuSpike.timer = setTimeout(() => {
      this.stopCpuSpike();
    }, durationSeconds * 1000);

    return this.getStatus();
  }

  stopCpuSpike() {
    this.state.cpuSpike.enabled = false;
    if (this.state.cpuSpike.activeInterval) clearInterval(this.state.cpuSpike.activeInterval);
    if (this.state.cpuSpike.timer) clearTimeout(this.state.cpuSpike.timer);
    this.state.cpuSpike.activeInterval = null;
    this.state.cpuSpike.timer = null;
    chaosFaultActive.set({ fault_type: 'cpu_spike', service: config.serviceName }, 0);
    logger.info('[CHAOS LAB] CPU Saturation burn stopped.');
    this.recordIncidentEvent('CPU_SATURATION_RESOLVED', 'CPU burn finished, utilization normalized.');
  }

  // 4. Memory Leak (Predictive Incidents - PromQL predict_linear)
  triggerMemoryLeak(chunkMbPerInterval = 8, intervalMs = 1500) {
    if (this.state.memoryLeak.enabled) return this.getStatus();

    this.state.memoryLeak.enabled = true;
    chaosFaultActive.set({ fault_type: 'memory_leak', service: config.serviceName }, 1);
    logger.warn(`[CHAOS LAB] Started predictive memory leak: leaking ${chunkMbPerInterval}MB every ${intervalMs}ms`);
    this.recordIncidentEvent('MEMORY_LEAK_STARTED', `Predictive incident: Linear leak started (+${chunkMbPerInterval}MB/${intervalMs}ms).`);

    this.state.memoryLeak.interval = setInterval(() => {
      try {
        const buffer = Buffer.alloc(chunkMbPerInterval * 1024 * 1024, 1);
        this.leakedBuffers.push(buffer);
        this.state.memoryLeak.allocatedMb += chunkMbPerInterval;

        const totalBytes = this.state.memoryLeak.allocatedMb * 1024 * 1024;
        memoryLeakGaugeBytes.set({ service: config.serviceName }, totalBytes);

        logger.info(`[CHAOS LAB] Leaked memory accumulated: ${this.state.memoryLeak.allocatedMb}MB`);
      } catch (err) {
        logger.error(`[CHAOS LAB] Memory leak hit threshold or error: ${err.message}`);
        this.stopMemoryLeak();
      }
    }, intervalMs);

    return this.getStatus();
  }

  stopMemoryLeak() {
    this.state.memoryLeak.enabled = false;
    if (this.state.memoryLeak.interval) clearInterval(this.state.memoryLeak.interval);
    this.state.memoryLeak.interval = null;

    // Release memory
    this.leakedBuffers = [];
    this.state.memoryLeak.allocatedMb = 0;
    memoryLeakGaugeBytes.set({ service: config.serviceName }, 0);
    chaosFaultActive.set({ fault_type: 'memory_leak', service: config.serviceName }, 0);

    if (global.gc) {
      global.gc();
    }

    logger.info('[CHAOS LAB] Memory leak stopped and buffers freed.');
    this.recordIncidentEvent('MEMORY_LEAK_RESOLVED', 'Leaked buffers freed, memory metric zeroed.');
  }

  // 5. Database Connection Pool Exhaustion (Saturation Metric)
  triggerDbExhaustion() {
    this.state.dbExhaustion.enabled = true;
    dbConnectionPoolActive.set({ service: config.serviceName }, 20); // maxed out!
    chaosFaultActive.set({ fault_type: 'db_exhaustion', service: config.serviceName }, 1);

    logger.error('[CHAOS LAB] Database connection pool saturated (20/20 active connections)');
    this.recordIncidentEvent('DB_POOL_EXHAUSTED', 'Active DB pool set to 20/20; incoming DB transactions will timeout.');

    return this.getStatus();
  }

  stopDbExhaustion() {
    this.state.dbExhaustion.enabled = false;
    dbConnectionPoolActive.set({ service: config.serviceName }, 3); // normal idle
    chaosFaultActive.set({ fault_type: 'db_exhaustion', service: config.serviceName }, 0);

    logger.info('[CHAOS LAB] DB connection pool released back to normal baseline (3 active).');
    this.recordIncidentEvent('DB_POOL_RESTORED', 'DB connection pool returned to healthy level (3/20).');
  }

  // 6. Deploy Regression (Deploy Guard)
  triggerDeployRegression(version = 'v1.4.3-regressed', commit = 'e94f12d') {
    this.state.deployRegression.enabled = true;
    this.state.deployRegression.version = version;
    this.state.deployRegression.commit = commit;

    deployRegressionActive.set({ service: config.serviceName, version, commit }, 1);
    chaosFaultActive.set({ fault_type: 'deploy_regression', service: config.serviceName }, 1);

    logger.warn(`[CHAOS LAB] Deployed version ${version} (commit: ${commit}) with simulated checkout regression.`);
    this.recordIncidentEvent('DEPLOY_REGRESSION_ACTIVE', `Deploy Guard flag set: regression on ${version} (${commit}).`);

    return this.getStatus();
  }

  stopDeployRegression() {
    this.state.deployRegression.enabled = false;
    deployRegressionActive.set({ service: config.serviceName, version: config.serviceVersion, commit: 'a1b2c3d' }, 0);
    chaosFaultActive.set({ fault_type: 'deploy_regression', service: config.serviceName }, 0);

    logger.info(`[CHAOS LAB] Rollback completed: Rolled back to ${config.serviceVersion}.`);
    this.recordIncidentEvent('DEPLOY_REGRESSION_ROLLED_BACK', `Rolled back to baseline ${config.serviceVersion}.`);
  }

  // 7. Inject Novel Loki Error Signatures (Log Anomaly Detection)
  injectNovelErrorSignatures(type = 'payment_deadlock', count = 3) {
    const signatures = {
      payment_deadlock: {
        name: 'PaymentGatewayDeadlockException',
        stack: 'PaymentGatewayDeadlockException: Transaction lock acquisition failed at OrderService.checkout (order_service.js:142:19)\n    at process.processTicksAndRejections (node:internal/process/task_queues:95:5)\n    at async OrderController.processPayment (controllers/orders.js:88:12)',
        meta: { component: 'PaymentGateway', transactionId: `tx-${Math.random().toString(36).substring(7)}`, attempts: 3 }
      },
      token_corruption: {
        name: 'AuthTokenMalformedSignatureError',
        stack: 'AuthTokenMalformedSignatureError: JWT signature segment unparseable or key rotation mismatch (crypto.js:89)\n    at verifyToken (middleware/auth.js:34:11)\n    at Layer.handle [as handle_request] (express/lib/router/layer.js:95:5)',
        meta: { component: 'AuthService', keyId: 'sec-2026-v2', algorithm: 'RS256' }
      },
      grpc_pool_timeout: {
        name: 'InventoryGrpcStreamTimeout',
        stack: 'InventoryGrpcStreamTimeout: DEADLINE_EXCEEDED: channel keepalive ping failed for inventory.internal:50051\n    at Object.callErrorFromStatus (grpc/lib/call.js:31:24)\n    at ClientReadableStream._emitStatus (grpc/lib/readable.js:189:10)',
        meta: { component: 'InventoryClient', remoteAddr: 'inventory.internal:50051', timeoutMs: 5000 }
      }
    };

    const target = signatures[type] || signatures.payment_deadlock;

    for (let i = 0; i < count; i++) {
      logger.novelErrorSignature(target.name, target.stack, target.meta);
    }

    chaosFaultActive.set({ fault_type: 'novel_error_logs', service: config.serviceName }, 1);
    this.recordIncidentEvent('NOVEL_ERROR_SIGNATURE_EMITTED', `Emitted ${count} novel logs with signature: ${target.name}`);

    setTimeout(() => {
      chaosFaultActive.set({ fault_type: 'novel_error_logs', service: config.serviceName }, 0);
    }, 15000);

    return { signature: target.name, count, meta: target.meta };
  }

  // Reset all chaos faults to healthy baseline
  resetAll() {
    this.stopErrorSpike();
    this.stopLatencySpike();
    this.stopCpuSpike();
    this.stopMemoryLeak();
    this.stopDbExhaustion();
    this.stopDeployRegression();

    logger.info('[CHAOS LAB] All chaos simulations reset. System restored to baseline.');
    this.recordIncidentEvent('SYSTEM_RESET_BASELINE', 'All active faults cleared; all metrics reset to baseline.');
    return this.getStatus();
  }

  recordIncidentEvent(eventType, description) {
    const event = {
      id: `evt-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      timestamp: new Date().toISOString(),
      type: eventType,
      description
    };
    this.recentIncidents.unshift(event);
    if (this.recentIncidents.length > 50) this.recentIncidents.pop();
  }

  getStatus() {
    return {
      service: config.serviceName,
      version: this.state.deployRegression.enabled ? this.state.deployRegression.version : config.serviceVersion,
      faults: {
        errorSpike: this.state.errorSpike.enabled ? { rate: this.state.errorSpike.rate } : false,
        latencySpike: this.state.latencySpike.enabled ? { delayMs: this.state.latencySpike.delayMs } : false,
        cpuSpike: this.state.cpuSpike.enabled,
        memoryLeak: this.state.memoryLeak.enabled ? { allocatedMb: this.state.memoryLeak.allocatedMb } : false,
        dbExhaustion: this.state.dbExhaustion.enabled,
        deployRegression: this.state.deployRegression.enabled ? { version: this.state.deployRegression.version, commit: this.state.deployRegression.commit } : false,
      },
      recentEvents: this.recentIncidents.slice(0, 10)
    };
  }
}

const chaosManager = new ChaosManager();
module.exports = chaosManager;
