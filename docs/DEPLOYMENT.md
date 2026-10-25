# Production Deployment & Scaling Architecture

This document details how the Operations Platform scales from a single-node prototype to an enterprise-grade, multi-region distributed system supporting **100,000+ concurrent devices** producing **20,000+ events/second**.

---

## 1. Cloud-Native Production Architecture

```mermaid
graph TD
    subgraph Edge & Security
        EDGE[IoT Edge Devices / Cellular Gateways]
        CDN[Cloudflare / AWS CloudFront + WAF]
        ALB[AWS Application Load Balancer / NGINX Ingress]
    end

    subgraph Ingestion Microservices
        INGEST1[Ingestion Pod 1]
        INGEST2[Ingestion Pod 2]
        INGESTN[Ingestion Pod N (HPA)]
    end

    subgraph Distributed Messaging Bus
        KAFKA[(Apache Kafka Cluster<br/>Partitioned by deviceId)]
    end

    subgraph State & Rule Processing Workers
        WORKER1[Stream Worker 1]
        WORKER2[Stream Worker 2]
        REDIS[(Redis Cluster<br/>Deduplication & State Cache)]
    end

    subgraph Storage Tier
        TIMESIZE[(TimescaleDB / Managed PostgreSQL<br/>ACID Relational & Events)]
        CLICKHOUSE[(ClickHouse / AWS Timestream<br/>Cold Telemetry Lake)]
    end

    subgraph Observability & Alerts
        PROM[Prometheus + Grafana]
        OTEL[OpenTelemetry Collector]
        PAGER[PagerDuty / Opsgenie Webhooks]
    end

    EDGE --> CDN --> ALB
    ALB --> INGEST1 & INGEST2 & INGESTN
    INGEST1 & INGEST2 & INGESTN --> KAFKA
    INGEST1 & INGEST2 & INGESTN -.->|Fast Idempotency Check| REDIS

    KAFKA --> WORKER1 & WORKER2
    WORKER1 & WORKER2 <--> REDIS
    WORKER1 & WORKER2 --> TIMESIZE
    WORKER1 & WORKER2 --> CLICKHOUSE
    WORKER1 & WORKER2 --> PAGER

    INGEST1 & WORKER1 --> OTEL --> PROM
```

---

## 2. Component Migration Path (Prototype -> Production)

| Component | Prototype Implementation | Production Cloud Architecture |
| :--- | :--- | :--- |
| **Ingestion API** | Express.js in-process server | Horizontal Pod Autoscalers (HPA) in Kubernetes (EKS/GKE) |
| **Deduplication** | In-memory LRU Map + SQLite | Redis Cluster with `SET key NX EX 3600` for global 1-hour idempotency |
| **Queue / Backpressure** | In-memory bounded queue | Apache Kafka (or AWS Kinesis) partitioned by `hash(deviceId) % num_partitions` |
| **Ordering Guarantee** | Per-device sequence counter | Kafka Per-Partition Monotonic Ordering (all events for device $X$ route to partition $Y$) |
| **Relational Database** | Embedded SQLite (WAL mode) | AWS Aurora PostgreSQL (Multi-AZ with read replicas) + TimescaleDB extension |
| **Telemetry Storage** | SQLite `events` table | ClickHouse / Amazon S3 Parquet tables for long-term analytical queries |
| **Dead Letter Queue** | SQLite `dlq_events` table | AWS SQS DLQ / Kafka dead-letter topic with automatic alarm routing |

---

## 3. High Concurrency & Sizing Calculations

### 3.1 Workload Profile (100,000 Devices)
* **Fleet Size**: 100,000 devices
* **Report Frequency**: Average 1 telemetry ping every 5 seconds
* **Throughput**:
  $$\text{Throughput} = \frac{100,000 \text{ devices}}{5 \text{ seconds}} = 20,000 \text{ events/sec}$$
* **Peak Burst Capacity** (e.g. after network recovery): $3 \times \text{nominal} = 60,000 \text{ events/sec}$
* **Average Payload Size**: $\approx 500$ bytes
* **Ingress Bandwidth**:
  $$20,000 \times 500 \text{ bytes} = 10 \text{ MB/sec} = 80 \text{ Mbps}$$

### 3.2 Compute Sizing
* **Ingestion Pods**: Stateless Go or Node.js containers consuming 0.5 vCPU and 512MB RAM can process ~2,500 req/sec.
  * Required pods: $\frac{20,000}{2,500} = 8 \text{ pods}$ (Auto-scaling range: 8 to 32 pods for burst absorption).
* **Kafka Cluster**: 6 brokers (AWS `kafka.m5.2xlarge`) with 60 partitions guarantees parallel, strictly ordered processing per device partition.
* **Database IOPS**: Writing to TimescaleDB with hypertable chunking and 50-event batch inserts requires ~400 write ops/sec, easily handled by 3,000 provisioned IOPS (gp3).

---

## 4. Observability & SRE Runbook

### 4.1 Key Performance Metrics (SLIs / SLOs)
* **Ingestion Availability**: $\ge 99.95\%$ HTTP 200/202 responses on `/api/events`.
* **Processing Latency**: $p99 < 50\text{ms}$ from ingestion to rule evaluation.
* **Duplicate Detection Rate**: Monitored via `events_duplicate_total`.
* **DLQ Growth Alarm**: Alert on-call SRE if `dlq_pending_events > 100` within 5 minutes.
* **Watchdog Silence Lag**: Alert if device silence detection exceeds configured threshold $+ 10\text{s}$.

### 4.2 Disaster Recovery & Multi-Region Replication
* **Active-Passive Multi-Region**: Primary region in `us-east-1` with warm standby in `us-west-2`.
* **Route 53 DNS Failover**: Automated health check reroutes device ingress in $< 60$ seconds.
* **Aurora Global Database**: Cross-region replication latency under 1 second.
