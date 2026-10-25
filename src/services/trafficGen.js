const config = require('../config');
const logger = require('../logger');

class TrafficGenerator {
  constructor() {
    this.intervalId = null;
    this.rps = 8; // requests per second
    this.stats = { totalRequests: 0, successful: 0, failed: 0, lastRps: 0 };
    this.recentCounter = 0;
    this.rateCalcTimer = null;
  }

  start(rps = 8) {
    if (this.intervalId) return;
    this.rps = rps;

    const endpoints = [
      { path: '/api/products', method: 'GET' },
      { path: '/api/products', method: 'GET' },
      { path: '/api/inventory', method: 'GET' },
      { path: '/api/users/profile', method: 'GET' },
      { path: '/api/orders', method: 'POST', body: { itemId: 'item-882', quantity: 2, amount: 49.99 } },
    ];

    const delayMs = Math.floor(1000 / this.rps);

    this.intervalId = setInterval(async () => {
      const ep = endpoints[Math.floor(Math.random() * endpoints.length)];
      const url = `http://localhost:${config.port}${ep.path}`;

      try {
        const opts = {
          method: ep.method,
          headers: { 'Content-Type': 'application/json', 'User-Agent': 'TrafficGenerator/1.0' },
          signal: AbortSignal.timeout(5000)
        };
        if (ep.body) opts.body = JSON.stringify(ep.body);

        this.stats.totalRequests++;
        this.recentCounter++;

        const res = await fetch(url, opts);
        if (res.ok) {
          this.stats.successful++;
        } else {
          this.stats.failed++;
        }
      } catch (err) {
        this.stats.failed++;
      }
    }, delayMs);

    this.rateCalcTimer = setInterval(() => {
      this.stats.lastRps = this.recentCounter;
      this.recentCounter = 0;
    }, 1000);

    logger.info(`[TRAFFIC GEN] Background traffic generator started at ~${rps} RPS`);
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    if (this.rateCalcTimer) {
      clearInterval(this.rateCalcTimer);
      this.rateCalcTimer = null;
    }
    this.stats.lastRps = 0;
    logger.info('[TRAFFIC GEN] Background traffic generator paused');
  }

  getStatus() {
    return {
      running: !!this.intervalId,
      targetRps: this.rps,
      currentRps: this.stats.lastRps,
      totalRequests: this.stats.totalRequests,
      successful: this.stats.successful,
      failed: this.stats.failed
    };
  }
}

const trafficGen = new TrafficGenerator();
module.exports = trafficGen;
