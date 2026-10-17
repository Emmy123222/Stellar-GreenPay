import {
  MONTHLY_GIVING_STORAGE_KEY,
  addMonths,
  createMonthlySubscription,
  loadMonthlySubscriptions,
  markMonthlySubscriptionPaid,
  saveMonthlySubscriptions,
} from "../monthlyGiving";
import type { MonthlySubscription } from "@/utils/types";

function subscription(
  overrides: Partial<MonthlySubscription> = {},
): MonthlySubscription {
  return {
    id: "sub_test",
    projectId: "project-1",
    projectName: "Amazon Reforestation Initiative",
    amountXLM: "25.0000000",
    startDate: "2026-01-31T00:00:00.000Z",
    durationMonths: 3,
    nextDueDate: "2026-01-31T00:00:00.000Z",
    remainingMonths: 3,
    status: "active",
    createdAt: "2026-01-31T00:00:00.000Z",
    history: [],
    ...overrides,
  };
}

beforeEach(() => {
  window.localStorage.clear();
});

describe("addMonths", () => {
  it("keeps the same day for ordinary month steps", () => {
    expect(addMonths("2026-03-15T00:00:00.000Z", 1)).toBe(
      "2026-04-15T00:00:00.000Z",
    );
  });

  it("rolls December over into January of the next year", () => {
    expect(addMonths("2026-12-15T00:00:00.000Z", 1)).toBe(
      "2027-01-15T00:00:00.000Z",
    );
  });

  it("clamps the 31st to the last day of February in a non-leap year", () => {
    expect(addMonths("2026-01-31T00:00:00.000Z", 1)).toBe(
      "2026-02-28T00:00:00.000Z",
    );
  });

  it("clamps the 31st to February 29 in a leap year", () => {
    expect(addMonths("2024-01-31T00:00:00.000Z", 1)).toBe(
      "2024-02-29T00:00:00.000Z",
    );
  });

  it("clamps the 31st to the last day of a 30-day month", () => {
    expect(addMonths("2026-08-31T00:00:00.000Z", 1)).toBe(
      "2026-09-30T00:00:00.000Z",
    );
  });

  it("does not drift backwards after a clamped month", () => {
    // Feb 28 + 1 month must return to the 28th, not the original 31st.
    expect(
      addMonths(addMonths("2026-01-31T00:00:00.000Z", 1), 1),
    ).toBe("2026-03-28T00:00:00.000Z");
  });

  it("handles multi-month steps across a year boundary", () => {
    expect(addMonths("2026-11-30T00:00:00.000Z", 3)).toBe(
      "2027-02-28T00:00:00.000Z",
    );
    expect(addMonths("2026-12-31T00:00:00.000Z", 2)).toBe(
      "2027-02-28T00:00:00.000Z",
    );
  });

  it("preserves the time of day in UTC", () => {
    expect(addMonths("2026-01-31T13:45:30.123Z", 1)).toBe(
      "2026-02-28T13:45:30.123Z",
    );
  });

  it("steps backwards across a year boundary", () => {
    expect(addMonths("2026-01-31T00:00:00.000Z", -1)).toBe(
      "2025-12-31T00:00:00.000Z",
    );
  });
});

describe("createMonthlySubscription", () => {
  it("uses the start date as the first charge date", () => {
    const created = createMonthlySubscription({
      projectId: "project-1",
      projectName: "Amazon Reforestation Initiative",
      amountXLM: "25.0000000",
      startDate: "2026-12-31T00:00:00.000Z",
      durationMonths: 6,
    });

    expect(created).toMatchObject({
      nextDueDate: "2026-12-31T00:00:00.000Z",
      remainingMonths: 6,
      status: "active",
      history: [],
    });
    expect(loadMonthlySubscriptions()[0]).toEqual(created);
  });
});

describe("markMonthlySubscriptionPaid", () => {
  it("advances an indefinite pledge across the year boundary", () => {
    const sub = subscription({
      remainingMonths: null,
      nextDueDate: "2026-12-15T00:00:00.000Z",
    });
    saveMonthlySubscriptions([sub]);

    markMonthlySubscriptionPaid(sub.id, "25.0000000");

    const [updated] = loadMonthlySubscriptions();
    expect(updated.nextDueDate).toBe("2027-01-15T00:00:00.000Z");
    expect(updated.remainingMonths).toBeNull();
    expect(updated.status).toBe("active");
    expect(updated.history[0]).toMatchObject({ amountXLM: "25.0000000" });
  });

  it("clamps month-end charge dates when advancing", () => {
    const sub = subscription({
      remainingMonths: null,
      nextDueDate: "2026-01-31T00:00:00.000Z",
    });
    saveMonthlySubscriptions([sub]);

    markMonthlySubscriptionPaid(sub.id, "25.0000000");

    expect(loadMonthlySubscriptions()[0].nextDueDate).toBe(
      "2026-02-28T00:00:00.000Z",
    );
  });

  it("completes the pledge after the final instalment", () => {
    const sub = subscription({
      remainingMonths: 1,
      nextDueDate: "2026-12-31T00:00:00.000Z",
    });
    saveMonthlySubscriptions([sub]);

    markMonthlySubscriptionPaid(sub.id, "25.0000000");

    const [updated] = loadMonthlySubscriptions();
    expect(updated.remainingMonths).toBe(0);
    expect(updated.status).toBe("completed");
    // The final charge is not rolled forward past the pledge's end.
    expect(updated.nextDueDate).toBe("2026-12-31T00:00:00.000Z");
    expect(updated.history).toHaveLength(1);
  });

  it("leaves other and already-completed subscriptions untouched", () => {
    const target = subscription({ id: "sub_target", remainingMonths: 2 });
    const other = subscription({
      id: "sub_other",
      nextDueDate: "2026-12-01T00:00:00.000Z",
    });
    const completed = subscription({
      id: "sub_completed",
      status: "completed",
      remainingMonths: 0,
      nextDueDate: "2026-01-01T00:00:00.000Z",
    });
    saveMonthlySubscriptions([target, other, completed]);

    markMonthlySubscriptionPaid(target.id, "25.0000000");

    const byId = Object.fromEntries(
      loadMonthlySubscriptions().map((sub) => [sub.id, sub]),
    );
    expect(byId.sub_target.nextDueDate).toBe("2026-02-28T00:00:00.000Z");
    expect(byId.sub_other).toEqual(other);
    expect(byId.sub_completed).toEqual(completed);
  });

  it("ignores malformed stored data", () => {
    window.localStorage.setItem(MONTHLY_GIVING_STORAGE_KEY, "not-json");

    expect(loadMonthlySubscriptions()).toEqual([]);
  });
});
