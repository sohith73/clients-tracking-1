import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button, StatTile } from "./shared";
import { LEGEND, currentMonth, monthLabel, shiftMonth } from "./format";

export function MonthNav({ month, onChange }) {
  return (
    <div className="inline-flex items-center gap-2">
      <Button variant="secondary" aria-label="Previous month" onClick={() => onChange(shiftMonth(month, -1))} className="!px-2.5">
        <ChevronLeft className="size-4" aria-hidden="true" />
      </Button>
      <p className="min-w-36 text-center text-sm font-semibold text-slate-900" aria-live="polite">
        {monthLabel(month)}
      </p>
      <Button variant="secondary" aria-label="Next month" onClick={() => onChange(shiftMonth(month, 1))} className="!px-2.5">
        <ChevronRight className="size-4" aria-hidden="true" />
      </Button>
      {month !== currentMonth() && (
        <Button variant="secondary" onClick={() => onChange(currentMonth())}>
          This month
        </Button>
      )}
    </div>
  );
}

export function Legend() {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-2" aria-label="Legend">
      {LEGEND.map((item) => (
        <li key={item.key} className="flex items-center gap-1.5 text-xs text-slate-700">
          <span className={`size-2.5 rounded-full ${item.dot}`} aria-hidden="true" />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

export function SummaryTiles({ summary }) {
  const tiles = [
    ["Present", summary.present, "text-emerald-700"],
    ["Half days", summary.halfDay, "text-amber-700"],
    ["Absent", summary.absent, "text-red-700"],
    ["Paid leave", summary.paidLeave, "text-blue-700"],
    ["Unpaid leave", summary.unpaidLeave, "text-orange-700"],
  ];
  if (summary.unsetLeave) tiles.push(["Pay not set", summary.unsetLeave, "text-violet-700"]);
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
      {tiles.map(([label, value, tone]) => (
        <StatTile key={label} label={label} value={value} tone={tone} />
      ))}
    </div>
  );
}
