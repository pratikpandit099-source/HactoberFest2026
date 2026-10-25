const express = require('express');
const cors = require('cors');
const path = require('path');
const config = require('./config');
const logger = require('./logger');
const { metricsMiddleware } = require('./metrics');

const apiRouter = require('./routes/api');
const chaosRouter = require('./routes/chaos');
const metricsRouter = require('./routes/metrics');
const trafficGen = require('./services/trafficGen');

const app = express();

// Global Middlewares
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Prometheus RED metrics collector middleware
app.use(metricsMiddleware);

// Serve static frontend dashboard
app.use(express.static(path.join(__dirname, 'public')));

// Prometheus scrape endpoint
app.use('/metrics', metricsRouter);

// Business & Chaos API routes
app.use('/api', apiRouter);
app.use('/chaos', chaosRouter);

// Root fallback to Dashboard
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start Server
app.listen(config.port, () => {
  logger.info(`=======================================================`);
  logger.info(` SRE Incident & Observability Service Started!`);
  logger.info(` Port:               ${config.port}`);
  logger.info(` Web UI Dashboard:   http://localhost:${config.port}`);
  logger.info(` Prometheus Scrape:  http://localhost:${config.port}/metrics`);
  logger.info(` Prometheus Server:  ${config.prometheusHost}`);
  logger.info(` Loki Ingestion:     ${config.lokiHost}`);
  logger.info(`=======================================================`);

  // Start background traffic generator for realistic metrics baseline
  if (config.autoTraffic) {
    trafficGen.start(6);
  }
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received. Shutting down gracefully...');
  trafficGen.stop();
  process.exit(0);
});

module.exports = app;
