/**
 * components/DescriptionAccordion.tsx
 * Expandable accordion for long project descriptions.
 */
import { useMemo, useRef, useState, useLayoutEffect } from "react";

type SectionKey = "Overview" | "Goals" | "How funds are used" | "Team";

interface Section {
  title: SectionKey;
  lines: string[];
}

const SECTION_TITLES: SectionKey[] = ["Overview", "Goals", "How funds are used", "Team"];

function normalizeHeading(input: string) {
  const cleaned = input
    .trim()
    .replace(/^#+\s*/, "")
    .replace(/:$/, "")
    .trim()
    .toLowerCase();

  if (cleaned === "overview") return "Overview";
  if (cleaned === "goals") return "Goals";
  if (cleaned === "how funds are used" || cleaned === "how funds are used ") return "How funds are used";
  if (cleaned === "team") return "Team";
  return null;
}

function parseSections(description: string): Section[] | null {
  const lines = description.split(/\r?\n/);
  const sections = new Map<SectionKey, string[]>();

  let current: SectionKey | null = null;
  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const heading = normalizeHeading(line);
    if (heading && SECTION_TITLES.includes(heading)) {
      current = heading;
      if (!sections.has(current)) sections.set(current, []);
      continue;
    }

    if (!current) continue;
    sections.get(current)?.push(rawLine);
  }

  const result = SECTION_TITLES
    .filter((t) => (sections.get(t) || []).some((l) => l.trim().length > 0))
    .map((t) => ({ title: t, lines: (sections.get(t) || []).filter((l) => l.trimEnd().length > 0) }));

  return result.length ? result : null;
}

function AccordionItem({
  title,
  lines,
  isOpen,
  onToggle,
}: {
  title: string;
  lines: string[];
  isOpen: boolean;
  onToggle: () => void;
}) {
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [maxHeight, setMaxHeight] = useState<number>(0);

  useLayoutEffect(() => {
    if (!contentRef.current) return;
    setMaxHeight(isOpen ? contentRef.current.scrollHeight : 0);
  }, [isOpen, lines]);

  return (
    <div className="rounded-2xl border border-forest-100 bg-white overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-forest-50/60 transition-colors"
        aria-expanded={isOpen}
      >
        <div className="min-w-0">
          <p className="font-semibold text-forest-900 font-body">{title}</p>
          {!isOpen && (
            <p className="text-xs text-forest-500 font-body mt-0.5">{lines.length} line{lines.length !== 1 ? "s" : ""}</p>
          )}
        </div>
        <span className="text-forest-500 flex-shrink-0">
          {isOpen ? "−" : "+"}
        </span>
      </button>

      <div
        className="px-4 overflow-hidden"
        style={{ maxHeight, transition: "max-height 320ms ease" }}
      >
        <div ref={contentRef} className="pb-4">
          <p className="text-[#5a7a5a] leading-relaxed text-sm whitespace-pre-wrap font-body">
            {lines.join("\n").trim()}
          </p>
        </div>
      </div>
    </div>
  );
}

export default function DescriptionAccordion({ description }: { description: string }) {
  const sections = useMemo(() => parseSections(description), [description]);
  const [open, setOpen] = useState<SectionKey | null>("Overview");

  if (!sections) {
    return (
      <p className="text-[#5a7a5a] leading-relaxed text-sm whitespace-pre-wrap font-body">
        {description}
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {sections.map((s) => (
        <AccordionItem
          key={s.title}
          title={s.title}
          lines={s.lines}
          isOpen={open === s.title}
          onToggle={() => setOpen((prev) => (prev === s.title ? null : s.title))}
        />
      ))}
    </div>
  );
}
