require('dotenv').config();

module.exports = {
  port: parseInt(process.env.PORT, 10) || 3000,
  serviceName: process.env.SERVICE_NAME || 'order-service',
  serviceVersion: process.env.SERVICE_VERSION || 'v1.4.2',
  env: process.env.NODE_ENV || 'production',
  prometheusHost: process.env.PROMETHEUS_HOST || 'http://localhost:9090',
  lokiHost: process.env.LOKI_HOST || 'http://localhost:3100',
  autoTraffic: process.env.AUTO_TRAFFIC === 'true' || true,
};
