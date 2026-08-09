# Reduce Latency for Calls from frontend-proxy to flagd

**Service:** flagd

## Why

The observed latency for calls from frontend-proxy to flagd is 868 ms, which is significantly higher than typical latencies observed in the architecture (all under 6 ms). This indicates a potential issue with the service configuration or the network path. Implementing a short-circuit solution, immediate timeout or caching for calls to flagd can drastically reduce this latency.

## Suggested fix

Add a local cache check in the frontend-proxy for frequent requests to flagd and set a connection timeout to 100 ms.

---
_Opened by Alyva, cites the evidence attached to this proposal — never applies itself, a human reviewed and approved this before it was opened._
