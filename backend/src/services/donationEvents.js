/**
 * Shared EventEmitter for donation events.
 *
 * Bridges WebSocket broadcasts and the SSE stream endpoint so that
 * both the REST API route and the Horizon indexer can push donation
 * events to connected SSE clients.
 *
 * In addition to broadcasting, the store keeps a small in-memory buffer of
 * recent events so SSE clients reconnecting with a Last-Event-ID header can
 * replay the events they missed. Each buffered event carries a sequential
 * numeric id and a project scope, enabling per-project replay and allowing
 * cross-project reconnection attempts to be rejected.
 *
 * @module services/donationEvents
 */
"use strict";

const { EventEmitter } = require("events");

class DonationEventStore extends EventEmitter {
  constructor() {
    super();
    // Prevent Node from throwing when >10 listeners attach (SSE clients
    // can accumulate during traffic spikes).
    this.setMaxListeners(0);

    this.counter = 0;
    this.events = [];
  }

  /**
   * Broadcast a donation event to live SSE listeners and append it to the
   * in-memory replay buffer. The original payload is forwarded untouched so
   * existing listeners keep working unchanged.
   *
   * @param {string} type - Emitted event name (e.g. "new_donation").
   * @param {object} payload - Donation event payload. May carry a
   *   `projectId` used to scope replay; defaults to "default" when absent.
   */
  emit(type, payload) {
    if (type === "new_donation" && payload) {
      const projectId = payload.projectId || "default";
      const id = (this.counter += 1);
      this.events.push({ id, projectId, data: payload });
    }
    return super.emit(type, payload);
  }

  /**
   * Find a buffered event by its numeric id.
   *
   * @param {string|number} id - The Last-Event-ID value supplied by a client.
   * @returns {{id:number, projectId:string, data:object}|undefined}
   */
  findEvent(id) {
    const num = Number(id);
    if (Number.isNaN(num)) return undefined;
    return this.events.find((event) => event.id === num);
  }

  /**
   * All buffered events for a project, in emission order.
   *
   * @param {string} [projectId] - Project scope; defaults to "default".
   * @returns {Array<{id:number, projectId:string, data:object}>}
   */
  getEventsForProject(projectId) {
    const scope = projectId || "default";
    return this.events.filter((event) => event.projectId === scope);
  }

  /**
   * Buffered events for a project whose id is strictly greater than `id`.
   *
   * @param {string} [projectId] - Project scope; defaults to "default".
   * @param {string|number} id - Last-Event-ID to resume after.
   * @returns {Array<{id:number, projectId:string, data:object}>}
   */
  getEventsAfter(projectId, id) {
    const scope = projectId || "default";
    const num = Number(id);
    return this.events.filter(
      (event) => event.projectId === scope && event.id > num,
    );
  }

  /**
   * Reset the buffer and id counter. Intended for use between tests.
   */
  clearEvents() {
    this.counter = 0;
    this.events = [];
  }
}

const donationEvents = new DonationEventStore();

module.exports = donationEvents;
