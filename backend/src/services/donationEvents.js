/**
 * Shared EventEmitter for donation events.
 *
 * Bridges WebSocket broadcasts and the SSE stream endpoint so that
 * both the REST API route and the Horizon indexer can push donation
 * events to connected SSE clients.
 *
 * @module services/donationEvents
 */
"use strict";

const { EventEmitter } = require("events");

const donationEvents = new EventEmitter();

// Prevent Node from throwing when >10 listeners attach (SSE clients
// can accumulate during traffic spikes).
donationEvents.setMaxListeners(0);

module.exports = donationEvents;
