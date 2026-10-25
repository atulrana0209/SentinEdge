# SentinEdge — Enterprise Deployment & Scaling Strategy

> **Platform**: SentinEdge  
> **Tagline**: *Autonomous Edge Fleet Telemetry & Incident Intelligence Platform*  
> **Author**: Forward Deployed Engineer / Principal Systems Architect

---

## 1. Executive Deployment Overview

While the prototype uses an embedded SQLite WAL architecture to provide a self-contained, turnkey local evaluation environment, production deployments for enterprise clients require a horizontally scalable, multi-tenant cloud-native architecture.

This document details the migration path, sizing calculations, container topology, and observability framework required to support **100,000+ concurrent edge devices** streaming **20,000+ events/second** across multiple geographical availability zones.

---

## 2. Target Production Architecture

```mermaid
graph TD
    subgraph Edge Tier
        FLEET[100,000+ Edge Devices & Gateways]
    end

    subgraph Ingress & Perimeter Security
        CLOUDFLARE[Cloudflare WAF / DDoS Shield]
        ALB[AWS Network Load Balancer / NGINX Ingress]
    end

    subgraph Kubernetes Ingestion Tier (EKS)
        HPA[Horizontal Pod Autoscaler (10 to 40 Pods)]
        INGEST1[Ingress Pod 1]
        INGEST2[Ingress Pod 2]
        INGESTN[Ingress Pod N]
    end

    subgraph Distributed Messaging Bus
        KAFKA[(Apache Kafka Cluster<br/>Partitioned by hash(deviceId) % 64)]
    end

    subgraph Stream Processing & Rule Evaluation
        STREAM1[Rule Engine Worker 1]
        STREAM2[Rule Engine Worker 2]
        REDIS[(Redis Cluster 7.x<br/>Distributed Deduplication & Rate Limiting)]
    end

    subgraph Storage Tier
        TIMESCALE[(AWS Aurora PostgreSQL + TimescaleDB<br/>Hypertables, Relational State, Incidents)]
        S3[(Amazon S3 Parquet Lake / ClickHouse<br/>Long-Term Cold Telemetry Archive)]
    end

    subgraph Observability & Alerts Tier
        OTEL[OpenTelemetry Collector DaemonSet]
        PROM[Prometheus + VictoriaMetrics]
        GRAFANA[Grafana Ops Command Center]
        PAGERDUTY[PagerDuty / Opsgenie Incident Webhooks]
    end

    FLEET -->|mTLS / HTTPS| CLOUDFLARE --> ALB
    ALB --> HPA
    HPA --> INGEST1 & INGEST2 & INGESTN

    INGEST1 & INGEST2 & INGESTN -.->|Idempotency Check: SET NX EX| REDIS
    INGEST1 & INGEST2 & INGESTN -->|Batch Produce| KAFKA

    KAFKA --> STREAM1 & STREAM2
    STREAM1 & STREAM2 <--> REDIS
    STREAM1 & STREAM2 -->|Batch Insert| TIMESCALE
    STREAM1 & STREAM2 -->|Stream Raw| S3
    STREAM1 & STREAM2 -->|Alerts via Circuit Breaker| PAGERDUTY

    INGEST1 & STREAM1 --> OTEL --> PROM --> GRAFANA
```

---

## 3. Data Layer Migration Path

### 3.1 Relational & Telemetry Store: SQLite $\rightarrow$ TimescaleDB on AWS Aurora
In the prototype, SQLite in WAL mode delivers ACID compliance and handles thousands of writes per second on a single NVMe disk. For production scale:

1. **Hypertables for Event Streaming**:
   * Migrate the `events` table to a TimescaleDB **Hypertable** partitioned on `timestamp` with 1-day chunk intervals.
   * Enables automatic chunk dropping for data retention policies (e.g., retain raw telemetry in hot storage for 30 days, roll up older data).
   ```sql
   -- TimescaleDB Production Schema
   CREATE TABLE events (
     id UUID NOT NULL,
     device_id VARCHAR(64) NOT NULL,
     sequence_number BIGINT NOT NULL,
     timestamp TIMESTAMPTZ NOT NULL,
     received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     event_type VARCHAR(32) NOT NULL,
     payload JSONB NOT NULL,
     is_duplicate BOOLEAN DEFAULT FALSE,
     is_out_of_order BOOLEAN DEFAULT FALSE
   );

   SELECT create_hypertable('events', 'timestamp', chunk_time_interval => INTERVAL '1 day');
   CREATE INDEX idx_events_device_time ON events (device_id, timestamp DESC);
   ```

2. **Continuous Aggregates**:
   * Pre-compute hourly and daily telemetry rollups (min, max, average temperature, battery drain) in the background with zero impact on ingestion throughput.

3. **Cold Storage Offloading**:
   * Stream raw telemetry asynchronously from Kafka directly into an **Amazon S3 Parquet Data Lake** using AWS Kinesis Firehose or ClickHouse for multi-year analytical querying and ML model training.

### 3.2 Deduplication & Caching: In-Memory Map $\rightarrow$ Distributed Redis Cluster
In multi-node ingestion, an in-memory Map cannot protect across pods.
* **Distributed Atomic Deduplication**:
  ```text
  SET event:dedup:{eventId} "1" NX EX 3600
  ```
  * `NX`: Sets the key only if it does not already exist. Returns `OK` if unique; returns `nil` if duplicate.
  * `EX 3600`: Automatically expires the key after 1 hour, bounding RAM footprint without manual garbage collection.
* **Global Monotonic Sequence Tracker**:
  * Edge sequence numbers are verified using Redis Hashes (`HGET device:{id} last_seq`), providing single-digit microsecond latency before database commits.

### 3.3 Event Streaming: In-Process Queue $\rightarrow$ Apache Kafka
* **Partitioning Strategy**: Telemetry events are partitioned by `hash(deviceId) % num_partitions`.
* **Guarantee**: Strictly guarantees in-order event processing for any given device, even under massive horizontal scale, because all events for a specific device are consumed sequentially by the designated stream worker.

---

## 4. Workload Profile & Sizing Calculations (100,000 Devices)

### 4.1 Throughput & Bandwidth
* **Active Devices**: 100,000 connected nodes
* **Reporting Frequency**: Nominal 1 event every 5 seconds per device
* **Nominal Ingestion Rate**:
  $$\text{Nominal Rate} = \frac{100,000}{5 \text{ seconds}} = 20,000 \text{ events/second}$$
* **Peak Surge / Post-Blackout Replay (3x Factor)**:
  $$\text{Peak Rate} = 3 \times 20,000 = 60,000 \text{ events/second}$$
* **Average Payload Size**: $\approx 500 \text{ bytes}$
* **Network Ingress Bandwidth**:
  $$20,000 \text{ events/s} \times 500 \text{ bytes} = 10 \text{ MB/second} = 80 \text{ Mbps}$$
  $$\text{Peak Bandwidth} = 60,000 \times 500 \text{ bytes} = 30 \text{ MB/second} = 240 \text{ Mbps}$$

### 4.2 Compute Capacity (Kubernetes Pod Sizing)
* **Ingress Gateway Pods**: Node.js/Go stateless ingress pods consuming 1 vCPU and 1 GB RAM process ~2,500 req/sec with schema validation and Redis dedup check.
  * Baseline Pod Count: $\frac{20,000}{2,500} = 8 \text{ pods}$.
  * Peak Surge Auto-scaling: Configure Kubernetes Horizontal Pod Autoscaler (HPA) to scale between **8 and 32 pods** based on 60% CPU utilization.
* **Kafka Cluster**: 6 brokers (AWS `kafka.m5.2xlarge`) with 64 partitions and replication factor 3.
* **Database IOPS**: With micro-batching (100 events per SQL multi-insert), 20,000 events/sec results in:
  $$\frac{20,000}{100} = 200 \text{ write batches/second}$$
  Easily accommodated by AWS Aurora with standard gp3 storage (3,000 IOPS baseline).

---

## 5. Containerization & Deployment Manifests

### 5.1 Production Multi-Stage Dockerfile
```dockerfile
# -------------------------------------------------------------
# Stage 1: Build Frontend Dashboard
# -------------------------------------------------------------
FROM node:22-alpine AS client-builder
WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

# -------------------------------------------------------------
# Stage 2: Production Node Runtime
# -------------------------------------------------------------
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=4000

# Install production server dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Copy application source
COPY server/ ./server/
COPY data/ ./data/

# Copy pre-compiled static client build from Stage 1
COPY --from=client-builder /app/client/dist ./client/dist

# Security hardening: Run as non-root user
USER node

EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=3s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost:4000/api/health || exit 1

CMD ["node", "--experimental-sqlite", "server/server.js"]
```

### 5.2 Kubernetes Deployment & Service Manifest
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: sentinedge-api
  namespace: production
  labels:
    app: sentinedge-api
spec:
  replicas: 8
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 25%
      maxUnavailable: 0
  selector:
    matchLabels:
      app: sentinedge-api
  template:
    metadata:
      labels:
        app: sentinedge-api
    spec:
      containers:
        - name: sentinedge-api
          image: 123456789012.dkr.ecr.us-east-1.amazonaws.com/sentinedge:latest
          resources:
            requests:
              cpu: "500m"
              memory: "512Mi"
            limits:
              cpu: "1500m"
              memory: "1Gi"
          ports:
            - containerPort: 4000
          envFrom:
            - configMapRef:
                name: sentinedge-config
            - secretRef:
                name: sentinedge-secrets
          readinessProbe:
            httpGet:
              path: /api/health
              port: 4000
            initialDelaySeconds: 5
            periodSeconds: 10
          livenessProbe:
            httpGet:
              path: /api/health
              port: 4000
            initialDelaySeconds: 15
            periodSeconds: 15
---
apiVersion: v1
kind: Service
metadata:
  name: sentinedge-service
  namespace: production
spec:
  type: ClusterIP
  ports:
    - port: 80
      targetPort: 4000
  selector:
    app: sentinedge-api
```

---

## 6. Observability, Logging & SRE Operations

### 6.1 Structured JSON Logging
All application logs are formatted as single-line JSON with distributed tracing correlation IDs:
```json
{
  "timestamp": "2026-10-25T21:40:00.120Z",
  "level": "INFO",
  "service": "sentinedge-ingestion",
  "trace_id": "c8f10a4e-9d21-4f81",
  "device_id": "sensor-nyc-01",
  "event_id": "evt-7f91a24b",
  "sequence_number": 142,
  "action": "EVENT_INGESTED",
  "is_duplicate": false,
  "is_out_of_order": false,
  "duration_ms": 1.2
}
```

### 6.2 Prometheus Metrics Exporter (`/api/metrics`)
The system exposes core operational metrics scraped every 15 seconds:
* `sentinedge_ingestion_total{status="accepted|duplicate|rejected"}` — Ingestion throughput counter.
* `sentinedge_queue_depth` — Current backlog in the bounded ingestion buffer.
* `sentinedge_processing_latency_seconds_bucket` — Histogram tracking $p50$, $p95$, and $p99$ processing latency.
* `sentinedge_circuit_breaker_state{channel="webhook"}` — `0 = CLOSED`, `1 = HALF_OPEN`, `2 = OPEN`.
* `sentinedge_active_incidents{severity="CRITICAL|WARNING"}` — Real-time gauge of open operational incidents.

### 6.3 SRE Alerting Thresholds & PagerDuty Policies
| Metric Condition | Severity | Automated Action |
| :--- | :--- | :--- |
| `sentinedge_queue_depth > 4000` for 2m | **CRITICAL** | Auto-scale HPA pods by +50%; page Primary On-Call. |
| `rate(sentinedge_ingestion_total{status="rejected"}[5m]) > 50` | **CRITICAL** | Backpressure saturation alert; check downstream DB IOPS. |
| `sentinedge_circuit_breaker_state == 2` for 5m | **WARNING** | External notification webhook failure; inspect PagerDuty endpoint. |
| `sentinedge_dlq_pending_events > 100` | **WARNING** | Corrupted firmware alert; sample quarantined DLQ payloads for bad schema. |
