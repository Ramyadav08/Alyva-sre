// Discover before asking — house rule #1. Pulls the real service inventory
// (with criticality, if the telemetry already carries it) plus a live
// snapshot per service (latency/error-rate/call-rate from shared/baseline.js,
// same multi-signal computation Alert Rules uses) — so every interview
// question opens with what was actually found, not a blind prompt.

const { discoverServices } = require("../../lgtm");
const { computeBaseline } = require("../../shared/baseline");

async function discoverWithSnapshots() {
  const services = await discoverServices();
  const withSnapshots = [];
  for (const svc of services) {
    const snapshot = await computeBaseline(svc.service_name);
    withSnapshots.push({ ...svc, snapshot });
  }
  return withSnapshots;
}

module.exports = { discoverWithSnapshots };
