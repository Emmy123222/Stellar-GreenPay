/**
 * Shared EventEmitter for donation events with SSE replay buffer.
 *
 * Bridges WebSocket broadcasts and the SSE stream endpoint so that
 * both the REST API route and the Horizon indexer can push donation
 * events to connected SSE clients with Last-Event-ID catch-up support.
 *
 * @module services/donationEvents
 */
"use strict";

const { EventEmitter } = require("events");

class DonationEventEmitter extends EventEmitter {
  constructor() {
    super();
    this.buffer = [];
    this.currentId = 0;
    this.maxBufferSize = 100;
  }

  emit(event, data, ...args) {
    if (event === "new_donation") {
      this.currentId += 1;
      const eventId = typeof args[0] === "number" ? args[0] : this.currentId;
      const entry = { id: eventId, data };
      this.buffer.push(entry);
      if (this.buffer.length > this.maxBufferSize) {
        this.buffer.shift();
      }
      return super.emit(event, data, eventId);
    }
    return super.emit(event, data, ...args);
  }

  getCatchUpEvents(lastEventId) {
    if (lastEventId === undefined || lastEventId === null || lastEventId === "") {
      return [];
    }
    const id = parseInt(lastEventId, 10);
    if (isNaN(id)) {
      return [...this.buffer];
    }
    if (id > this.currentId) {
      return [];
    }
    if (id < 0) {
      return [...this.buffer];
    }
    return this.buffer.filter((entry) => entry.id > id);
  }

  resetBuffer() {
    this.buffer = [];
    this.currentId = 0;
  }
}

const donationEvents = new DonationEventEmitter();
donationEvents.setMaxListeners(0);

module.exports = donationEvents;
