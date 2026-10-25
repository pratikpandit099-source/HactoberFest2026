# 🛡️ SRE Incident Observability & Chaos Lab

An automated SRE incident detection and response platform built with **Node.js**, **Prometheus**, **Grafana**, and **Loki**. 

Includes a real-time **Chaos Lab** that injects realistic microservice failures (RED metric anomalies, saturation spikes, predictive leaks, and novel Loki log signatures) to test automated anomaly detection and incident report generation.

---

## 🚀 Key Architectural Stages (The Incident Flow)

```
[Target Service]
      │
      ├─► Metrics (RED & Saturation) ──────► Prometheus (:9090) ┐
      └─► Structured JSON Logs ────────────► Loki (:3100)       ┼─► [AI Monitor Agent]
                                                                │       │
                                                                │       ├─► Stage 3: Initial Report
                                                                │       ├─► Stage 4: Investigate
                                                                │       ├─► Stage 5: Verify Fix
                                                                │       └─► Stage 6: Final Report
                                                                ▼
                                                        Grafana Dashboard (:3001)
```

1. **Detect (Statistics, No LLM in Scrape Path)**:
   - Polls **Prometheus** every 10–30s:
     - **RED Metrics**: Request rate (`http_requests_total`), error rate (5xx ratio > 5%), and latency duration (p99 > 1.0s).
     - **Saturation**: CPU usage, memory heap, and DB connection pool capacity (`db_connection_pool_active`).
     - **SLO Burn Rate & Trends**: Forecasts memory leak saturation using PromQL `predict_linear`.
   - Polls **Loki**:
     - Error log rates via LogQL.
     - Brand-new unhandled error signatures and log patterns.
2. **Triage (AI Monitor Agent)**:
   - Correlates metric and log anomalies into an incident hash key (`service:signal`) to deduplicate noise.
   - Calculates severity (`SEV1` / `SEV2`) and confidence score.
3. **Initial Report (Notification 1)**:
   - Dispatches within 2 minutes: Affected component, severity, estimated impact, confidence score, and PromQL/LogQL evidence.
4. **Investigate & Fix Recommendation**:
   - Compares deep metrics, recent logs, and git commit revisions to produce ranked root cause and runbook diff.
5. **Verify**:
   - Verifies metrics return to baseline for N minutes.
6. **Final Report (Notification 2)**:
   - Emits root cause, impact window, verified diff / draft PR link, and prevention items.

---

## ⚡ High-Impact Features Built-In

1. **Deploy Guard**:
   - Flags post-deployment regressions (schema mismatches, checkout errors) with exact commit hash and rollback recommendations (`/chaos/deploy-regression`).
2. **Predictive Incidents**:
   - Uses PromQL `predict_linear(memory_leak_gauge_bytes[1m], 300)` to detect upward memory slopes and alert **before** heap exhaustion crashes the service.
3. **Chaos Lab as Ground Truth**:
   - Web UI & REST endpoints to trigger labeled faults for measuring detection precision, recall, and time-to-report.

---

## 📂 Project Structure

```
.
├── docker-compose.yml              # Prometheus, Loki, Grafana, and Node App
├── Dockerfile                      # Production Docker container
├── package.json                    # Scripts & dependencies
├── .env.example                    # Environment template
├── src/
│   ├── index.js                    # Express application entrypoint
│   ├── config.js                   # Configuration & env variables
│   ├── metrics.js                  # prom-client RED & saturation metrics
│   ├── logger.js                   # Structured Winston + direct Loki HTTP pusher
│   ├── routes/
│   │   ├── api.js                  # Business endpoints (/api/products, /api/orders, etc.)
│   │   ├── chaos.js                # Chaos fault injection endpoints
│   │   └── metrics.js              # /metrics Prometheus scrape endpoint
│   ├── services/
│   │   ├── chaosManager.js         # Fault state manager & event audit log
│   │   └── trafficGen.js           # Realistic background traffic simulator (6-10 RPS)
│   └── public/
│       ├── index.html              # Dark-mode Chaos Control Dashboard
│       └── app.js                  # Real-time state polling & trigger handlers
├── monitor/
│   └── incidentWatcher.js          # Automated SRE Monitor (Stages 1-6 implementation)
├── prometheus/
│   ├── prometheus.yml              # Prometheus scraper config (5s interval)
│   └── alerts.yml                  # Prometheus alert rules (RED, Saturation, Deploy Guard)
├── loki/
│   └── loki-config.yml             # Loki filesystem storage config
└── grafana/
    └── provisioning/
        ├── datasources/
        │   └── datasources.yml     # Auto-provisioned Prometheus & Loki
        └── dashboards/
            ├── dashboards.yml
            └── sre_incident_dashboard.json # Pre-loaded SRE RED & Saturation dashboard
```

---

## 🛠️ Quickstart Guide

### Option 1: Full Docker Stack (Recommended)

Starts Node.js API, Prometheus, Loki, and Grafana in a unified network:

```bash
# 1. Start all containers
docker compose up -d

# 2. View running services
docker compose ps
```

- **Chaos Lab Web UI**: [http://localhost:3000](http://localhost:3000)
- **Grafana SRE Dashboard**: [http://localhost:3001](http://localhost:3001) *(auto-login as admin)*
- **Prometheus UI & Alerts**: [http://localhost:9090/alerts](http://localhost:9090/alerts)
- **Loki Endpoint**: [http://localhost:3100](http://localhost:3100)

To start the automated AI incident detector:
```bash
npm run monitor
```

---

### Option 2: Run Locally (Standalone Node.js)

```bash
# 1. Install dependencies
npm install

# 2. Start the application
npm start
```

Open [http://localhost:3000](http://localhost:3000) in your browser. The built-in traffic generator starts automatically to simulate steady baseline traffic.

---

## 🧪 Chaos Lab Endpoints & Incident Simulation

You can trigger incidents via the **Web UI at `http://localhost:3000`** or by calling these REST endpoints:

### 1. HTTP 5xx Error Spike (SEV1 RED Metric)
Trips `sum(rate(http_requests_total{status_code=~"5.."}[1m])) > 5%`.
```bash
# Trigger 85% error rate for 60 seconds
curl -X POST http://localhost:3000/chaos/error-spike \
  -H "Content-Type: application/json" \
  -d '{"rate": 0.85, "durationSeconds": 60}'

# Stop immediately
curl -X POST http://localhost:3000/chaos/error-spike/stop
```

### 2. P99 Latency Spike (SEV2 RED Metric)
Trips `histogram_quantile(0.99, ...) > 1.0s`.
```bash
# Inject 2500ms latency delay
curl -X POST http://localhost:3000/chaos/latency-spike \
  -H "Content-Type: application/json" \
  -d '{"delayMs": 2500, "durationSeconds": 60}'

# Stop latency injection
curl -X POST http://localhost:3000/chaos/latency-spike/stop
```

### 3. Predictive Memory Leak (Predictive Saturation)
Trips `predict_linear(memory_leak_gauge_bytes[1m], 300) > 80MB`.
```bash
# Leaks 8MB every 1.5 seconds
curl -X POST http://localhost:3000/chaos/memory-leak \
  -H "Content-Type: application/json" \
  -d '{"chunkMb": 8, "intervalMs": 1500}'

# Free leaked memory
curl -X POST http://localhost:3000/chaos/memory-leak/stop
```

### 4. CPU Saturation Burn
Trips `rate(process_cpu_user_seconds_total[1m]) * 100 > 60%`.
```bash
curl -X POST http://localhost:3000/chaos/cpu-spike \
  -H "Content-Type: application/json" \
  -d '{"durationSeconds": 30}'
```

### 5. DB Connection Pool Exhaustion (SEV1 Saturation)
Saturates mock pool to 20/20 active connections; transactions fail with 503s.
```bash
# Saturate pool
curl -X POST http://localhost:3000/chaos/connection-exhaustion

# Release connections
curl -X POST http://localhost:3000/chaos/connection-exhaustion/stop
```

### 6. Novel Error Signatures (Loki Log Anomaly Detection)
Emits brand-new error signatures (`PaymentGatewayDeadlockException`, `AuthTokenMalformedSignatureError`) for testing Loki pattern clustering.
```bash
curl -X POST http://localhost:3000/chaos/novel-error-signature \
  -H "Content-Type: application/json" \
  -d '{"type": "payment_deadlock", "count": 3}'
```

### 7. Deploy Guard: Post-Deployment Regression
Simulates deployment of `v1.4.3-regressed` (commit `e94f12d`) with broken checkout DB schema:
```bash
# Deploy regression
curl -X POST http://localhost:3000/chaos/deploy-regression \
  -H "Content-Type: application/json" \
  -d '{"version": "v1.4.3-regressed", "commit": "e94f12d"}'

# Rollback
curl -X POST http://localhost:3000/chaos/deploy-regression/rollback
```

### 8. Full 90-Second Automated Scenario
Runs end-to-end chaos cycle (baseline &rarr; 5xx errors &rarr; latency spike &rarr; memory leak &rarr; recovery):
```bash
curl -X POST http://localhost:3000/chaos/scenario/full-cycle
```

### 9. Reset All to Healthy Baseline
```bash
curl -X POST http://localhost:3000/chaos/reset
```

---

## 📊 Essential PromQL & LogQL Queries

| Alert / Metric | PromQL / LogQL Query |
| :--- | :--- |
| **Request Rate (RPS)** | `sum(rate(http_requests_total[1m])) by (route)` |
| **5xx Error Rate Ratio** | `sum(rate(http_requests_total{status_code=~"5.."}[1m])) / sum(rate(http_requests_total[1m]))` |
| **P99 Request Latency** | `histogram_quantile(0.99, sum(rate(http_request_duration_seconds_bucket[1m])) by (le))` |
| **Predictive Memory Leak** | `predict_linear(memory_leak_gauge_bytes[1m], 300)` |
| **CPU Saturation %** | `rate(process_cpu_user_seconds_total[1m]) * 100` |
| **DB Pool Active** | `db_connection_pool_active` |
| **Deploy Regression** | `deploy_regression_active == 1` |
| **Loki Error Log Stream** | `{service="order-service"} \|= "error"` |
| **Loki Novel Signatures** | `{service="order-service"} \|= "NOVEL_SIGNATURE"` |

---

## 📜 License
MIT License.
