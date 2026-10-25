const express = require('express');
const router = express.Router();
const chaosManager = require('../services/chaosManager');
const logger = require('../logger');

// Helper to simulate latency
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Interceptor for chaos effects
router.use(async (req, res, next) => {
  const { faults } = chaosManager.getStatus();

  // 1. Inject Latency Spike if active
  if (faults.latencySpike) {
    const jitter = Math.floor(Math.random() * 400) - 200;
    const delay = Math.max(100, faults.latencySpike.delayMs + jitter);
    await sleep(delay);
  }

  // 2. Inject HTTP 5xx Error Spike if active
  if (faults.errorSpike) {
    const shouldFail = Math.random() < faults.errorSpike.rate;
    if (shouldFail) {
      logger.error(`[CHAOS FAULT] Simulated 500 Internal Error on ${req.method} ${req.originalUrl}`, {
        route: req.originalUrl,
        statusCode: 500,
        cause: 'ChaosManager.errorSpike'
      });
      return res.status(500).json({
        error: 'InternalServerError',
        message: 'Simulated service failure in microservice pipeline',
        timestamp: new Date().toISOString()
      });
    }
  }

  next();
});

// GET /api/health
router.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    chaos: chaosManager.getStatus()
  });
});

// GET /api/products
router.get('/products', (req, res) => {
  res.json({
    products: [
      { id: 'prod-101', name: 'High-Performance Cloud VM', price: 99.0, stock: 45 },
      { id: 'prod-102', name: 'Distributed Cache Node', price: 49.0, stock: 120 },
      { id: 'prod-103', name: 'Managed Kubernetes Cluster', price: 299.0, stock: 15 }
    ]
  });
});

// GET /api/inventory
router.get('/inventory', async (req, res) => {
  // DB Exhaustion check
  if (chaosManager.state.dbExhaustion.enabled) {
    await sleep(400); // simulate waiting for connection
    logger.error('[CHAOS FAULT] DatabaseConnectionTimeout: Pool exhausted (20/20 active) on inventory query', {
      component: 'PostgreSQLPool',
      errorType: 'PoolTimeout'
    });
    return res.status(503).json({
      error: 'DatabaseConnectionTimeout',
      message: 'Active DB connection pool exhausted. Timed out waiting for connection.'
    });
  }

  res.json({
    warehouseId: 'us-east-1',
    activeItems: 4500,
    status: 'IN_STOCK'
  });
});

// GET /api/users/profile
router.get('/users/profile', (req, res) => {
  res.json({
    userId: 'usr-9941',
    name: 'SRE Test User',
    role: 'SiteReliabilityEngineer',
    org: 'Platform Engineering'
  });
});

// POST /api/orders
router.post('/orders', async (req, res) => {
  // DB Exhaustion check
  if (chaosManager.state.dbExhaustion.enabled) {
    await sleep(400);
    logger.error('[CHAOS FAULT] DB Transaction acquire failed: connection pool saturated', {
      component: 'OrderDatabase',
      action: 'BEGIN_TRANSACTION'
    });
    return res.status(503).json({
      error: 'ServiceUnavailable',
      message: 'Database connection pool capacity exceeded.'
    });
  }

  // Deploy Regression check
  if (chaosManager.state.deployRegression.enabled) {
    const { version, commit } = chaosManager.state.deployRegression;
    // 60% chance of failing checkout under regression
    if (Math.random() < 0.6) {
      logger.error(`[DEPLOY REGRESSION] SchemaMismatchError in checkout on ${version} (${commit}): column "tax_rate_v2" not found`, {
        version,
        commit,
        route: '/api/orders',
        regression: true
      });
      return res.status(500).json({
        error: 'DeployRegressionError',
        message: `Schema mismatch on order processing. Deploy commit: ${commit}`,
        version
      });
    }
  }

  const { itemId, quantity = 1, amount = 99.0 } = req.body || {};
  res.status(201).json({
    orderId: `ord-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    status: 'CONFIRMED',
    itemId: itemId || 'prod-101',
    quantity,
    totalAmount: amount,
    processedAt: new Date().toISOString()
  });
});

module.exports = router;
