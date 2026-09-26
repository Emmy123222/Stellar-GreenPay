/**
 * Shared EventEmitter for donation events with Last-Event-ID replay buffer.
 *
 * Bridges WebSocket broadcasts and the SSE stream endpoint so that
 * both the REST API route and the Horizon indexer can push donation
 * events to connected SSE clients.
 *
 * @module services/donationEvents
 */
"use strict";

const { EventEmitter } = require("events");

class DonationEventEmitter extends EventEmitter {
  constructor() {
    super();
    this.nextEventId = 1;
    this.eventBuffer = [];
    this.maxBufferSize = 100;
  }

  emit(eventName, data) {
    if (eventName === "new_donation") {
      const id = this.nextEventId++;
      const record = { id, data };
      this.eventBuffer.push(record);
      if (this.eventBuffer.length > this.maxBufferSize) {
        this.eventBuffer.shift();
      }
      return super.emit(eventName, { id, ...data });
    }
    return super.emit(eventName, data);
  }

  getEventsAfter(lastEventId) {
    if (lastEventId === undefined || lastEventId === null) {
      return [];
    }
    const parsedId = Number(lastEventId);
    if (!Number.isInteger(parsedId) || parsedId < 0) {
      // Reconnect with invalid ID -> all events since last reset returned
      return [...this.eventBuffer];
    }
    // Reconnect with future ID -> empty catch-up list
    if (parsedId >= this.nextEventId) {
      return [];
    }
    // Return events with id > parsedId
    return this.eventBuffer.filter((event) => event.id > parsedId);
  }

  resetEvents() {
    this.eventBuffer = [];
    this.nextEventId = 1;
  }
}

const donationEvents = new DonationEventEmitter();

// Prevent Node from throwing when >10 listeners attach (SSE clients
// can accumulate during traffic spikes).
donationEvents.setMaxListeners(0);

module.exports = donationEvents;
