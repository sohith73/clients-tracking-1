import { useState } from "react";
import { Plus, Save, Trash2 } from "lucide-react";
import { useAttendance } from "./useAttendance";
import { AttendancePage, Button, Card, EmptyState, ErrorMessage, Notice, Skeleton, inputClass } from "./shared";
import { WEEKDAYS } from "./format";

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function SettingsForm({ settings, api }) {
  const [weeklyOffDays, setWeeklyOffDays] = useState(settings.weeklyOffDays);
  const [holidays, setHolidays] = useState(settings.holidays.map((h) => ({ date: h.date, name: h.name })));
  const [saved, setSaved] = useState(false);
  const edit = (updater) => {
    setSaved(false);
    updater();
  };
  const patchHoliday = (index, patch) => edit(() => setHolidays(holidays.map((h, j) => (j === index ? { ...h, ...patch } : h))));

  return (
    <form
      className="space-y-6 max-w-3xl"
      onSubmit={async (e) => {
        e.preventDefault();
        setSaved(await api.mutate("admin/settings", { weeklyOffDays, holidays }, "PUT"));
      }}
    >
      <Card title="Weekly offs" description="Days nobody is expected to work. They never count as absent or as leave days.">
        <fieldset>
          <legend className="sr-only">Weekly offs</legend>
          <div className="flex flex-wrap gap-2">
            {DAY_NAMES.map((name, i) => {
              const on = weeklyOffDays.includes(i);
              return (
                <label
                  key={name}
                  className={`inline-flex h-10 cursor-pointer select-none items-center gap-2 rounded-md border px-3 text-sm font-medium transition-colors duration-200 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-blue-600 has-[:focus-visible]:ring-offset-2 ${
                    on ? "border-blue-600 bg-blue-50 text-blue-900" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={on}
                    onChange={(e) => edit(() => setWeeklyOffDays(e.target.checked ? [...weeklyOffDays, i].sort() : weeklyOffDays.filter((d) => d !== i)))}
                  />
                  <span aria-hidden="true">{WEEKDAYS[i]}</span>
                  <span className="sr-only">{name}</span>
                </label>
              );
            })}
          </div>
        </fieldset>
      </Card>

      <Card
        title="Holidays"
        description="Company holidays. Leave requests skip these dates."
        action={
          <Button variant="secondary" size="sm" icon={Plus} onClick={() => edit(() => setHolidays([...holidays, { date: "", name: "" }]))}>
            Add holiday
          </Button>
        }
      >
        {holidays.length === 0 ? (
          <EmptyState title="No holidays added">Add one with the button above.</EmptyState>
        ) : (
          <ul className="space-y-3">
            {holidays.map((holiday, i) => (
              <li key={i} className="grid grid-cols-[9.5rem_1fr_auto] items-end gap-3">
                <div>
                  <label htmlFor={`holiday-date-${i}`} className="mb-1.5 block text-xs font-medium text-slate-700">
                    Date
                  </label>
                  <input id={`holiday-date-${i}`} required type="date" className={inputClass} value={holiday.date} onChange={(e) => patchHoliday(i, { date: e.target.value })} />
                </div>
                <div>
                  <label htmlFor={`holiday-name-${i}`} className="mb-1.5 block text-xs font-medium text-slate-700">
                    Name
                  </label>
                  <input id={`holiday-name-${i}`} required maxLength={80} className={inputClass} value={holiday.name} onChange={(e) => patchHoliday(i, { name: e.target.value })} placeholder="Diwali" />
                </div>
                <Button variant="danger" aria-label={`Remove holiday ${holiday.name || i + 1}`} onClick={() => edit(() => setHolidays(holidays.filter((_, j) => j !== i)))} className="!px-2.5">
                  <Trash2 className="size-4" aria-hidden="true" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <ErrorMessage error={api.error} />
      {saved && !api.error && <Notice>Settings saved.</Notice>}
      <Button type="submit" icon={Save} loading={api.busy}>
        Save settings
      </Button>
    </form>
  );
}

export default function AdminAttendanceSettings() {
  const api = useAttendance("admin/settings");
  return (
    <AttendancePage title="Settings" subtitle="Weekly offs and holidays decide which days count." admin>
      {api.data ? <SettingsForm settings={api.data.settings} api={api} /> : api.error ? <ErrorMessage error={api.error} /> : <Skeleton className="h-48 w-full max-w-3xl" />}
    </AttendancePage>
  );
}
