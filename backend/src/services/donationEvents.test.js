/**
 * backend/src/services/donationEvents.test.js
 *
 * Unit tests for the shared donation EventEmitter (issue #1543):
 * fan-out of confirmed donation events plus the in-memory replay buffer
 * that backs SSE Last-Event-ID reconnects (cf. routes/donations.js SSE
 * stream endpoint).
 */
"use strict";

const { EventEmitter } = require("events");

const donationEvents = require("./donationEvents");

describe("donationEvents store", () => {
  beforeEach(() => {
    donationEvents.removeAllListeners();
    donationEvents.clearEvents();
  });

  afterEach(() => {
    donationEvents.removeAllListeners();
    donationEvents.clearEvents();
  });

  test("is an EventEmitter shared as a module singleton", () => {
    expect(donationEvents).toBeInstanceOf(EventEmitter);
    expect(require("./donationEvents")).toBe(donationEvents);
  });

  test("allows unlimited SSE listeners (no MaxListenersExceededWarning)", () => {
    expect(donationEvents.getMaxListeners()).toBe(0);
  });

  // ── Acceptance criterion: event emission for a confirmed donation ──
  describe("emitting a confirmed donation", () => {
    const donation = {
      projectName: "Solar for Schools",
      amountXLM: "25",
      donorBadge: "Gold",
    };

    test("delivers the untouched payload to every listener", () => {
      const first = jest.fn();
      const second = jest.fn();
      donationEvents.on("new_donation", first);
      donationEvents.on("new_donation", second);

      const delivered = donationEvents.emit("new_donation", donation);

      expect(delivered).toBe(true);
      expect(first).toHaveBeenCalledTimes(1);
      expect(first).toHaveBeenCalledWith(donation);
      expect(second).toHaveBeenCalledTimes(1);
      expect(second).toHaveBeenCalledWith(donation);
      // Original payload forwarded by reference, unchanged.
      expect(first.mock.calls[0][0]).toBe(donation);
    });

    test("buffers the event with sequential ids for replay", () => {
      donationEvents.emit("new_donation", donation);
      donationEvents.emit("new_donation", { ...donation, amountXLM: "10" });

      expect(donationEvents.events).toHaveLength(2);
      expect(donationEvents.events[0]).toEqual({
        id: 1,
        projectId: "default",
        data: donation,
      });
      expect(donationEvents.events[1].id).toBe(2);
      expect(donationEvents.events[1].data.amountXLM).toBe("10");
    });

    test("scopes the buffered event to its projectId when present", () => {
      donationEvents.emit("new_donation", {
        ...donation,
        projectId: "project-42",
      });

      expect(donationEvents.events[0].projectId).toBe("project-42");
      expect(donationEvents.getEventsForProject("project-42")).toHaveLength(1);
      expect(donationEvents.getEventsForProject("default")).toHaveLength(0);
    });
  });

  test("does not buffer events without a payload", () => {
    const listener = jest.fn();
    donationEvents.on("new_donation", listener);

    donationEvents.emit("new_donation", undefined);

    expect(listener).toHaveBeenCalledWith(undefined);
    expect(donationEvents.events).toHaveLength(0);
    expect(donationEvents.counter).toBe(0);
  });

  test("delivers but does not buffer non-donation events", () => {
    const listener = jest.fn();
    donationEvents.on("badge_earned", listener);

    const delivered = donationEvents.emit("badge_earned", {
      donorAddress: "GABC",
      badge: "Gold",
      projectId: "project-42",
    });

    expect(delivered).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(donationEvents.events).toHaveLength(0);
    expect(donationEvents.counter).toBe(0);
  });

  test("returns false when a donation event has no listeners", () => {
    expect(donationEvents.emit("new_donation", { amountXLM: "1" })).toBe(
      false,
    );
    // Still buffered so late-reconnecting SSE clients can replay it.
    expect(donationEvents.events).toHaveLength(1);
  });

  describe("findEvent", () => {
    beforeEach(() => {
      donationEvents.emit("new_donation", { amountXLM: "5" });
      donationEvents.emit("new_donation", {
        amountXLM: "7",
        projectId: "project-42",
      });
    });

    test("finds a buffered event by numeric id", () => {
      const found = donationEvents.findEvent(1);
      expect(found).toEqual({
        id: 1,
        projectId: "default",
        data: { amountXLM: "5" },
      });
    });

    test("finds a buffered event by string id (Last-Event-ID header)", () => {
      expect(donationEvents.findEvent("2").data.amountXLM).toBe("7");
    });

    test("returns undefined for a non-numeric id", () => {
      expect(donationEvents.findEvent("not-a-number")).toBeUndefined();
    });

    test("returns undefined for an unknown id", () => {
      expect(donationEvents.findEvent(99)).toBeUndefined();
    });
  });

  describe("getEventsForProject", () => {
    beforeEach(() => {
      donationEvents.emit("new_donation", { amountXLM: "1" });
      donationEvents.emit("new_donation", {
        amountXLM: "2",
        projectId: "project-a",
      });
      donationEvents.emit("new_donation", { amountXLM: "3" });
      donationEvents.emit("new_donation", {
        amountXLM: "4",
        projectId: "project-b",
      });
    });

    test("defaults to the default project scope", () => {
      const events = donationEvents.getEventsForProject();
      expect(events.map((e) => e.id)).toEqual([1, 3]);
      expect(events.every((e) => e.projectId === "default")).toBe(true);
    });

    test("returns only the requested project's events in emission order", () => {
      expect(
        donationEvents.getEventsForProject("project-a").map((e) => e.id),
      ).toEqual([2]);
      expect(
        donationEvents.getEventsForProject("project-b").map((e) => e.id),
      ).toEqual([4]);
      expect(donationEvents.getEventsForProject("missing")).toEqual([]);
    });
  });

  describe("getEventsAfter (Last-Event-ID replay)", () => {
    beforeEach(() => {
      donationEvents.emit("new_donation", { amountXLM: "1" });
      donationEvents.emit("new_donation", {
        amountXLM: "2",
        projectId: "project-a",
      });
      donationEvents.emit("new_donation", { amountXLM: "3" });
      donationEvents.emit("new_donation", { amountXLM: "4" });
    });

    test("returns events strictly after the given id for the default scope", () => {
      expect(
        donationEvents.getEventsAfter(undefined, 2).map((e) => e.id),
      ).toEqual([3, 4]);
      expect(donationEvents.getEventsAfter("default", 2).map((e) => e.id)).toEqual(
        [3, 4],
      );
    });

    test("never replays another project's events", () => {
      // id 2 belongs to project-a and must not leak into the default stream.
      expect(
        donationEvents.getEventsAfter(undefined, 1).map((e) => e.id),
      ).toEqual([3, 4]);
      expect(
        donationEvents.getEventsAfter("project-a", 1).map((e) => e.id),
      ).toEqual([2]);
    });

    test("returns all default-scope events for id 0 (first connect)", () => {
      expect(
        donationEvents.getEventsAfter(undefined, 0).map((e) => e.id),
      ).toEqual([1, 3, 4]);
    });

    test("returns an empty list for an unparseable id", () => {
      expect(donationEvents.getEventsAfter(undefined, "bogus")).toEqual([]);
    });
  });

  describe("clearEvents", () => {
    test("empties the buffer and restarts the id counter", () => {
      donationEvents.emit("new_donation", { amountXLM: "1" });
      donationEvents.emit("new_donation", { amountXLM: "2" });

      donationEvents.clearEvents();

      expect(donationEvents.events).toEqual([]);
      expect(donationEvents.counter).toBe(0);

      donationEvents.emit("new_donation", { amountXLM: "3" });
      expect(donationEvents.events).toEqual([
        { id: 1, projectId: "default", data: { amountXLM: "3" } },
      ]);
    });
  });
});
