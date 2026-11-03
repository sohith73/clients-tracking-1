import { useState } from "react";
import { CalendarPlus, Save, Trash2 } from "lucide-react";
import { useAttendance } from "./useAttendance";
import { AttendancePage, Button, Card, EmptyState, ErrorMessage, Field, Notice, Skeleton, inputClass } from "./shared";
import { WEEKDAYS, formatDay, istToday } from "./format";

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const adjustedText = (count) => (count ? ` ${count} leave ${count === 1 ? "request was" : "requests were"} adjusted because it covered a day off.` : "");

function HolidayPage({ settings, api }) {
  const [draft, setDraft] = useState({ date: "", name: "" });
  const [offDays, setOffDays] = useState(settings.weeklyOffDays);
  const [message, setMessage] = useState("");
  const today = istToday();
  const holidays = settings.holidays;
  const upcoming = holidays.filter((h) => h.date >= today);
  const past = holidays.filter((h) => h.date < today).reverse();
  const offChanged = offDays.length !== settings.weeklyOffDays.length || offDays.some((d) => !settings.weeklyOffDays.includes(d));
  const duplicate = holidays.some((h) => h.date === draft.date);

  // Each save sends the other half exactly as stored, so adding a holiday never saves half-edited weekly offs.
  const saveHolidays = async (next, done) => {
    setMessage("");
    const result = await api.mutate("admin/settings", { weeklyOffDays: settings.weeklyOffDays, holidays: next }, "PUT");
    if (result) setMessage(`${done}${adjustedText(result.adjustedLeaves)}`);
    return !!result;
  };
  const saveOffDays = async () => {
    setMessage("");
    const result = await api.mutate("admin/settings", { weeklyOffDays: offDays, holidays }, "PUT");
    if (result) setMessage(`Weekly offs saved.${adjustedText(result.adjustedLeaves)}`);
  };

  const HolidayRow = ({ holiday, muted }) => (
    <li className="flex items-center justify-between gap-3 py-2.5">
      <div className="min-w-0">
        <p className={`truncate text-sm font-medium ${muted ? "text-slate-500" : "text-slate-900"}`}>{holiday.name}</p>
        <p className="text-xs tabular-nums text-slate-600">{formatDay(holiday.date)}</p>
      </div>
      <Button variant="danger" size="sm" icon={Trash2} disabled={api.busy} aria-label={`Remove ${holiday.name} on ${holiday.date}`} onClick={() => saveHolidays(holidays.filter((h) => h.date !== holiday.date), `${holiday.name} removed.`)}>
        Remove
      </Button>
    </li>
  );

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,380px)_1fr]">
      <div className="space-y-6">
        <Card title="Mark a holiday for everyone" description="It applies to the whole team. Nobody applies for leave on it, and it never counts as a leave day.">
          <form
            className="space-y-4"
            onSubmit={async (e) => {
              e.preventDefault();
              const next = [...holidays, { date: draft.date, name: draft.name.trim() }].sort((a, b) => a.date.localeCompare(b.date));
              if (await saveHolidays(next, `${draft.name.trim()} is now a holiday.`)) setDraft({ date: "", name: "" });
            }}
          >
            <Field label="Date" htmlFor="holiday-date">
              <input id="holiday-date" required type="date" className={inputClass} value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} />
            </Field>
            <Field label="Reason" htmlFor="holiday-name" hint={duplicate ? "That date is already a holiday." : "Everyone sees this on their leave page and calendar."}>
              <input id="holiday-name" required maxLength={80} className={inputClass} placeholder="Diwali, office closed" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </Field>
            <ErrorMessage error={api.error} />
            <Button type="submit" icon={CalendarPlus} loading={api.busy} disabled={duplicate} className="w-full">
              Mark as holiday
            </Button>
          </form>
        </Card>

        <Card title="Weekly offs" description="Days of the week nobody works.">
          <fieldset>
            <legend className="sr-only">Weekly offs</legend>
            <div className="flex flex-wrap gap-2">
              {DAY_NAMES.map((name, i) => {
                const on = offDays.includes(i);
                return (
                  <label
                    key={name}
                    className={`inline-flex h-10 cursor-pointer select-none items-center rounded-md border px-3 text-sm font-medium transition-colors duration-200 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-blue-600 has-[:focus-visible]:ring-offset-2 ${
                      on ? "border-blue-600 bg-blue-50 text-blue-900" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    <input type="checkbox" className="sr-only" checked={on} onChange={(e) => setOffDays(e.target.checked ? [...offDays, i].sort() : offDays.filter((d) => d !== i))} />
                    <span aria-hidden="true">{WEEKDAYS[i]}</span>
                    <span className="sr-only">{name}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>
          <Button className="mt-4" variant="secondary" icon={Save} disabled={!offChanged} loading={api.busy && offChanged} onClick={saveOffDays}>
            Save weekly offs
          </Button>
        </Card>
      </div>

      <div className="space-y-4">
        {message && !api.error && <Notice>{message}</Notice>}
        <Card title="Upcoming holidays" description="Pending and approved leave that falls on a new holiday is adjusted for you. Removing a holiday does not add days back.">
          {upcoming.length === 0 ? (
            <EmptyState icon={CalendarPlus} title="No upcoming holidays">Mark one with the form on the left.</EmptyState>
          ) : (
            <ul className="-my-2 divide-y divide-slate-100">
              {upcoming.map((h) => (
                <HolidayRow key={h.date} holiday={h} />
              ))}
            </ul>
          )}
        </Card>
        {past.length > 0 && (
          <details className="rounded-lg border border-slate-200 bg-white shadow-sm">
            <summary className="cursor-pointer select-none px-5 py-3 text-sm font-medium text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600">Past holidays ({past.length})</summary>
            <ul className="divide-y divide-slate-100 px-5 pb-2">
              {past.map((h) => (
                <HolidayRow key={h.date} holiday={h} muted />
              ))}
            </ul>
          </details>
        )}
      </div>
    </div>
  );
}

export default function AdminAttendanceSettings() {
  const api = useAttendance("admin/settings");
  return (
    <AttendancePage title="Holidays" subtitle="Mark company holidays and weekly offs. Leave requests skip these days." admin>
      {api.data ? <HolidayPage key={JSON.stringify(api.data.settings.weeklyOffDays)} settings={api.data.settings} api={api} /> : api.error ? <ErrorMessage error={api.error} /> : <Skeleton className="h-64 w-full" />}
    </AttendancePage>
  );
}
