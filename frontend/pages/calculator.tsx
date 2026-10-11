/**
 * pages/calculator.tsx
 *
 * Carbon footprint calculator (#1306).
 *
 * The page lets a visitor estimate the CO₂ footprint of their own lifestyle
 * (flights, car, diet, home energy) and turns that estimate into the XLM
 * donation that would fully offset it on GreenPay, so the calculator doubles
 * as the front door for offsetting donations.
 *
 * The offset rate comes from the selected project's `co2_per_xlm`
 * (grams of CO₂ offset per 1 XLM, see docs/contract-integration.md), falling
 * back to the documented mainnet example rate when no project publishes a
 * non-zero rate. The resulting amount is handed to the project page through
 * the existing `?amount=` pre-fill, which DonateForm already consumes.
 */
import { useEffect, useMemo, useState } from "react";
import Head from "next/head";
import Link from "next/link";
import { fetchProjects } from "@/lib/api";
import type { ClimateProject } from "@/utils/types";

/** Average CO₂ of one economy round-trip flight (short/mid-haul, ~160 kg). */
export const KG_CO2_PER_FLIGHT = 160;

/** Average passenger-car intensity (European Environment Agency, ~171 g/km). */
export const KG_CO2_PER_CAR_KM = 0.171;

/** Global average grid intensity (IEA, ~479 g CO₂ per kWh). */
export const KG_CO2_PER_KWH = 0.479;

/**
 * Fallback offset rate in grams of CO₂ per XLM, matching the mainnet
 * registration example in docs/deployment-mainnet.md.
 */
export const DEFAULT_GRAMS_CO2_PER_XLM = 8500;

export const DIET_OPTIONS = [
  { key: "vegan", label: "Vegan", kgPerYear: 1500 },
  { key: "vegetarian", label: "Vegetarian", kgPerYear: 1700 },
  { key: "pescatarian", label: "Pescatarian", kgPerYear: 1900 },
  { key: "omnivore", label: "Omnivore", kgPerYear: 2500 },
  { key: "highMeat", label: "High meat", kgPerYear: 3300 },
] as const;

export type DietKey = (typeof DIET_OPTIONS)[number]["key"];

export interface FootprintInput {
  flights: number;
  carKm: number;
  diet: DietKey;
  monthlyKwh: number;
}

/** Annual CO₂ footprint in kilograms for the given lifestyle inputs. */
export function computeFootprintKg({ flights, carKm, diet, monthlyKwh }: FootprintInput): number {
  const dietKg = DIET_OPTIONS.find((o) => o.key === diet)?.kgPerYear ?? 0;
  return (
    flights * KG_CO2_PER_FLIGHT +
    carKm * KG_CO2_PER_CAR_KM +
    dietKg +
    monthlyKwh * 12 * KG_CO2_PER_KWH
  );
}

/** XLM that must be donated to offset the given tonnes of CO₂ (rounded up). */
export function computeOffsetXlm(tonnes: number, gramsPerXlm: number): number {
  if (tonnes <= 0 || gramsPerXlm <= 0) return 0;
  return Math.ceil((tonnes * 1_000_000) / gramsPerXlm);
}

function SliderField({
  id,
  label,
  value,
  min,
  max,
  step,
  display,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display: string;
  onChange: (next: number) => void;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1.5">
        <label htmlFor={id} className="text-sm font-semibold text-forest-800 dark:text-[#c8e6d0]">
          {label}
        </label>
        <span className="text-sm font-mono text-forest-600 dark:text-[#60d07b]">{display}</span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-forest-600"
      />
    </div>
  );
}

export default function CalculatorPage() {
  const [flights, setFlights] = useState(2);
  const [carKm, setCarKm] = useState(8000);
  const [diet, setDiet] = useState<DietKey>("omnivore");
  const [monthlyKwh, setMonthlyKwh] = useState(350);
  const [projects, setProjects] = useState<ClimateProject[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [projectsLoaded, setProjectsLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchProjects()
      .then((all) => {
        if (cancelled) return;
        setProjects(all);
        setProjectsLoaded(true);
        const preferred = all.find((p) => (p.co2_per_xlm ?? 0) > 0) ?? all[0];
        if (preferred) setSelectedProjectId(preferred.id);
      })
      .catch(() => {
        if (!cancelled) setProjectsLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const footprintKg = useMemo(
    () => computeFootprintKg({ flights, carKm, diet, monthlyKwh }),
    [flights, carKm, diet, monthlyKwh],
  );
  const tonnes = footprintKg / 1000;

  const selectedProject = projects.find((p) => p.id === selectedProjectId);
  const projectRate = selectedProject?.co2_per_xlm ?? 0;
  const usingDefaultRate = !(projectRate > 0);
  const gramsPerXlm = usingDefaultRate ? DEFAULT_GRAMS_CO2_PER_XLM : projectRate;

  const offsetXlm = computeOffsetXlm(tonnes, gramsPerXlm);

  const breakdown = [
    { label: "Flights", kg: flights * KG_CO2_PER_FLIGHT },
    { label: "Car travel", kg: carKm * KG_CO2_PER_CAR_KM },
    { label: "Diet", kg: DIET_OPTIONS.find((o) => o.key === diet)?.kgPerYear ?? 0 },
    { label: "Home energy", kg: monthlyKwh * 12 * KG_CO2_PER_KWH },
  ];

  const canDonate = Boolean(selectedProject) && offsetXlm > 0;

  return (
    <div className="min-h-screen bg-[#fcfdfc] font-body text-forest-900 dark:bg-[#0a1710] dark:text-[#e6f5e9] pb-20">
      <Head>
        <title>Carbon Footprint Calculator | Stellar GreenPay</title>
        <meta
          name="description"
          content="Estimate your annual carbon footprint from flights, driving, diet and home energy — and find out how much XLM fully offsets it."
        />
      </Head>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 pt-10">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-forest-500 dark:text-[#60d07b] mb-3">
          Carbon footprint calculator
        </p>
        <h1 className="font-display text-3xl sm:text-4xl font-bold mb-3">
          How big is your yearly footprint?
        </h1>
        <p className="text-forest-700 dark:text-[#a9c9b4] max-w-2xl mb-8">
          Move the sliders to describe your lifestyle. We estimate your annual CO₂ emissions
          and show exactly how much XLM it takes to offset the whole footprint through a
          GreenPay climate project.
        </p>

        <div className="grid md:grid-cols-2 gap-6 items-start">
          {/* Inputs */}
          <section
            aria-label="Lifestyle inputs"
            className="bg-white dark:bg-[#0e1f13] rounded-2xl border border-forest-100 dark:border-[rgba(96,208,123,0.18)] p-6 space-y-6 shadow-sm"
          >
            <SliderField
              id="calculator-flights"
              label="Flights per year"
              value={flights}
              min={0}
              max={52}
              step={1}
              display={`${flights} ${flights === 1 ? "flight" : "flights"}`}
              onChange={setFlights}
            />
            <SliderField
              id="calculator-car-km"
              label="Car kilometres per year"
              value={carKm}
              min={0}
              max={40000}
              step={500}
              display={`${carKm.toLocaleString("en-US")} km`}
              onChange={setCarKm}
            />
            <SliderField
              id="calculator-energy"
              label="Home energy per month"
              value={monthlyKwh}
              min={0}
              max={2000}
              step={25}
              display={`${monthlyKwh} kWh`}
              onChange={setMonthlyKwh}
            />

            <fieldset>
              <legend className="text-sm font-semibold text-forest-800 dark:text-[#c8e6d0] mb-2">
                Diet type
              </legend>
              <div className="flex flex-wrap gap-2">
                {DIET_OPTIONS.map((option) => (
                  <label
                    key={option.key}
                    className={`cursor-pointer rounded-full border px-3 py-1.5 text-sm transition-colors ${
                      diet === option.key
                        ? "border-forest-600 bg-forest-600 text-white dark:border-[#60d07b] dark:bg-[#1c3928] dark:text-[#e6f5e9]"
                        : "border-forest-200 text-forest-700 hover:border-forest-400 dark:border-[rgba(96,208,123,0.25)] dark:text-[#a9c9b4]"
                    }`}
                  >
                    <input
                      type="radio"
                      name="calculator-diet"
                      value={option.key}
                      checked={diet === option.key}
                      onChange={() => setDiet(option.key)}
                      className="sr-only"
                    />
                    {option.label}
                  </label>
                ))}
              </div>
            </fieldset>
          </section>

          {/* Results */}
          <section
            aria-label="Estimated footprint"
            className="bg-forest-900 dark:bg-[#12271a] text-white rounded-2xl p-6 shadow-sm space-y-5"
          >
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-forest-300 dark:text-[#60d07b] mb-1">
                Estimated annual footprint
              </p>
              <p className="font-display text-5xl font-bold">
                {tonnes.toFixed(1)}{" "}
                <span className="text-lg font-semibold text-forest-300">tonnes CO₂</span>
              </p>
            </div>

            <ul className="text-sm space-y-1.5 text-forest-200 dark:text-[#a9c9b4]">
              {breakdown.map((row) => (
                <li key={row.label} className="flex justify-between gap-4">
                  <span>{row.label}</span>
                  <span className="font-mono">{(row.kg / 1000).toFixed(2)} t</span>
                </li>
              ))}
            </ul>

            <p className="text-base leading-relaxed border-t border-forest-700 dark:border-[rgba(96,208,123,0.2)] pt-4">
              Your footprint is <strong>{tonnes.toFixed(1)} tonnes</strong>. You need to donate{" "}
              <strong>{offsetXlm.toLocaleString("en-US")} XLM</strong> to fully offset it.
            </p>

            <div className="space-y-3">
              <label htmlFor="calculator-project" className="block text-sm text-forest-200">
                Offset through
              </label>
              <select
                id="calculator-project"
                value={selectedProjectId}
                onChange={(e) => setSelectedProjectId(e.target.value)}
                disabled={!projectsLoaded || projects.length === 0}
                className="w-full rounded-lg border border-forest-700 bg-forest-800 px-3 py-2 text-sm text-white disabled:opacity-60 dark:border-[rgba(96,208,123,0.25)] dark:bg-[#0e1f13]"
              >
                {projects.length === 0 && <option value="">Loading projects…</option>}
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>

              <p className="text-xs text-forest-300 dark:text-[#7fa58c]">
                {usingDefaultRate
                  ? `Using the default offset rate of ${DEFAULT_GRAMS_CO2_PER_XLM.toLocaleString("en-US")} g CO₂ per XLM.`
                  : `Offset rate: ${projectRate.toLocaleString("en-US")} g CO₂ per XLM.`}
              </p>

              {canDonate && selectedProject ? (
                <Link
                  href={`/projects/${selectedProject.id}?amount=${offsetXlm}`}
                  className="block w-full rounded-lg bg-[#60d07b] px-4 py-3 text-center font-semibold text-forest-900 hover:bg-[#78dc90] transition-colors"
                >
                  Donate to offset my footprint
                </Link>
              ) : (
                <button
                  type="button"
                  disabled
                  className="block w-full rounded-lg bg-forest-700 px-4 py-3 text-center font-semibold text-forest-300 opacity-60 cursor-not-allowed"
                >
                  Donate to offset my footprint
                </button>
              )}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
