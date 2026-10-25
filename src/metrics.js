const client = require('prom-client');
const config = require('./config');

// Initialize Prometheus registry
const register = new client.Registry();

// Add default recommended node process metrics (CPU, Memory, Event Loop Lag, GC, File Descriptors)
client.collectDefaultMetrics({
  register,
  prefix: 'node_',
  labels: { service: config.serviceName, env: config.env }
});

// RED Metrics: Requests Total Counter
const httpRequestsTotal = new client.Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests processed, labeled by method, route, and status code.',
  labelNames: ['method', 'route', 'status_code', 'service'],
});
register.registerMetric(httpRequestsTotal);

// RED Metrics: Duration Histogram (Latency)
const httpRequestDurationSeconds = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Histogram of HTTP request durations in seconds.',
  labelNames: ['method', 'route', 'status_code', 'service'],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0]
});
register.registerMetric(httpRequestDurationSeconds);

// Saturation: Memory Leak Gauge (for PromQL predict_linear testing)
const memoryLeakGaugeBytes = new client.Gauge({
  name: 'memory_leak_gauge_bytes',
  help: 'Simulated memory leak size in bytes for testing PromQL predict_linear.',
  labelNames: ['service']
});
register.registerMetric(memoryLeakGaugeBytes);

// Saturation: Database Connection Pool Gauges
const dbConnectionPoolActive = new client.Gauge({
  name: 'db_connection_pool_active',
  help: 'Current number of active database connections in the pool.',
  labelNames: ['service']
});
register.registerMetric(dbConnectionPoolActive);

const dbConnectionPoolMax = new client.Gauge({
  name: 'db_connection_pool_max',
  help: 'Maximum database connection pool capacity.',
  labelNames: ['service']
});
register.registerMetric(dbConnectionPoolMax);
dbConnectionPoolMax.set({ service: config.serviceName }, 20);
dbConnectionPoolActive.set({ service: config.serviceName }, 3); // normal idle baseline

// Deploy Guard: Deploy Regression Flag
const deployRegressionActive = new client.Gauge({
  name: 'deploy_regression_active',
  help: 'Indicator flag (1 = active regression, 0 = baseline) for Deploy Guard tests.',
  labelNames: ['service', 'version', 'commit']
});
register.registerMetric(deployRegressionActive);
deployRegressionActive.set({ service: config.serviceName, version: config.serviceVersion, commit: 'a1b2c3d' }, 0);

// Active Chaos Injections Gauge
const chaosFaultActive = new client.Gauge({
  name: 'chaos_fault_active',
  help: 'Indicator of active chaos fault injections.',
  labelNames: ['fault_type', 'service']
});
register.registerMetric(chaosFaultActive);

// Express Middleware to measure request rate, status code, and duration
function metricsMiddleware(req, res, next) {
  // Ignore Prometheus /metrics and static asset polling for cleaner business metrics
  if (req.path === '/metrics' || req.path.startsWith('/public') || req.path === '/favicon.ico') {
    return next();
  }

  const start = process.hrtime();

  res.on('finish', () => {
    const diff = process.hrtime(start);
    const durationSeconds = diff[0] + diff[1] / 1e9;
    const route = req.route ? req.baseUrl + req.route.path : req.path;
    const statusCode = res.statusCode ? res.statusCode.toString() : '500';

    httpRequestsTotal.inc({
      method: req.method,
      route,
      status_code: statusCode,
      service: config.serviceName
    });

    httpRequestDurationSeconds.observe(
      {
        method: req.method,
        route,
        status_code: statusCode,
        service: config.serviceName
      },
      durationSeconds
    );
  });

  next();
}

module.exports = {
  register,
  httpRequestsTotal,
  httpRequestDurationSeconds,
  memoryLeakGaugeBytes,
  dbConnectionPoolActive,
  dbConnectionPoolMax,
  deployRegressionActive,
  chaosFaultActive,
  metricsMiddleware
};
