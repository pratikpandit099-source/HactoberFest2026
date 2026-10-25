const winston = require('winston');
const config = require('./config');

// Winston JSON structured logger
const winstonLogger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DDTHH:mm:ss.SSSZ' }),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: {
    service: config.serviceName,
    version: config.serviceVersion,
    env: config.env
  },
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ level, message, timestamp, ...meta }) => {
          const metaStr = Object.keys(meta).length ? JSON.stringify(meta) : '';
          return `[${timestamp}] ${level}: ${message} ${metaStr}`;
        })
      )
    })
  ]
});

// Helper to push structured logs directly to Loki's HTTP push API
async function pushToLoki(level, message, extraLabels = {}, extraMeta = {}) {
  const timestampNs = (BigInt(Date.now()) * 1000000n).toString();
  const streamLabels = {
    service: config.serviceName,
    env: config.env,
    level: level.toLowerCase(),
    ...extraLabels
  };

  const payload = {
    streams: [
      {
        stream: streamLabels,
        values: [
          [
            timestampNs,
            JSON.stringify({
              timestamp: new Date().toISOString(),
              level,
              message,
              service: config.serviceName,
              version: config.serviceVersion,
              ...extraMeta
            })
          ]
        ]
      }
    ]
  };

  try {
    const url = `${config.lokiHost}/loki/api/v1/push`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(2000)
    });

    if (!response.ok && response.status !== 204) {
      // Silently catch Loki push errors in development
    }
  } catch (err) {
    // Loki might be offline or starting up; ignore network errors gracefully
  }
}

// Unified Logger API
const logger = {
  info(msg, meta = {}) {
    winstonLogger.info(msg, meta);
    pushToLoki('info', msg, {}, meta);
  },
  warn(msg, meta = {}) {
    winstonLogger.warn(msg, meta);
    pushToLoki('warn', msg, {}, meta);
  },
  error(msg, meta = {}) {
    winstonLogger.error(msg, meta);
    pushToLoki('error', msg, { category: meta.category || 'application' }, meta);
  },
  // Dedicated helper for novel error signatures (Loki pattern clustering / LogQL tests)
  novelErrorSignature(signatureName, stackTrace, metadata = {}) {
    const formattedMsg = `[NOVEL_SIGNATURE] [${signatureName}] ${stackTrace}`;
    winstonLogger.error(formattedMsg, { ...metadata, signature: signatureName, isNovel: true });
    pushToLoki('error', formattedMsg, { signature: signatureName, error_type: 'novel' }, metadata);
  }
};

module.exports = logger;
