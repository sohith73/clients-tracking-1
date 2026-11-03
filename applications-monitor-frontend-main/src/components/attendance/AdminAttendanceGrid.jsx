import { useState } from "react";
import { Download, Save } from "lucide-react";
import { useAttendance } from "./useAttendance";
import { AttendancePage, Avatar, Button, EmptyState, ErrorMessage, Field, Modal, Skeleton, inputClass, Card } from "./shared";
import { Legend, MonthNav } from "./parts";
import { WEEKDAYS, cap, currentMonth, dayStyle, formatDay, formatTime, weekdayOf } from "./format";

// A cell starting with = + - @ would run as a formula when the CSV opens in a spreadsheet, so it is prefixed with a quote.
const csvCell = (value) => {
  let text = String(value ?? "");
  if (/^[=+@-]/.test(text.trimStart()) || ["\t", "\r", "\n"].includes(text[0])) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
};

export default function AdminAttendanceGrid() {
  const [month, setMonth] = useState(currentMonth);
  const api = useAttendance(`admin/attendance?month=${month}`);
  const [edit, setEdit] = useState(null);
  const [override, setOverride] = useState("");
  const [note, setNote] = useState("");
  const people = api.data?.people;

  const exportCsv = () => {
    const rows = [["Employee", "Email", "Date", "Status", "Check in", "Check out", "Leave pay", "Note"]];
    for (const person of people || [])
      for (const day of person.days) rows.push([person.user.name, person.user.email, day.day, day.status, day.checkInAt, day.checkOutAt, day.leave?.payType, day.overrideNote]);
    const url = URL.createObjectURL(new Blob(["﻿" + rows.map((row) => row.map(csvCell).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `attendance-${month}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const openEdit = (person, day) => {
    setEdit({ person, day });
    setOverride(day.override || "");
    setNote(day.overrideNote || "");
  };

  return (
    <AttendancePage
      title="Attendance grid"
      subtitle="Select any day to correct it. Dates and times use IST."
      admin
      actions={
        <Button variant="secondary" icon={Download} onClick={exportCsv} disabled={!people?.length}>
          Export CSV
        </Button>
      }
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <MonthNav month={month} onChange={setMonth} />
      </div>
      <ErrorMessage error={!edit && api.error} />

      <Card className="overflow-hidden" >
        {!people ? (
          <Skeleton className="h-48 w-full" />
        ) : people.length === 0 ? (
          <EmptyState title="No employees yet">People appear here once they have an account.</EmptyState>
        ) : (
          <div className="-m-5 overflow-x-auto">
            <table className="w-full border-separate border-spacing-0 text-xs">
              <thead>
                <tr>
                  <th scope="col" className="sticky left-0 z-10 min-w-48 border-b border-r border-slate-200 bg-slate-50 px-3 py-2 text-left text-xs font-medium text-slate-600">
                    Employee
                  </th>
                  {people[0].days.map((day) => (
                    <th key={day.day} scope="col" className="min-w-9 border-b border-slate-200 bg-slate-50 px-1 py-1.5 text-center font-medium text-slate-600">
                      <span className="block tabular-nums text-slate-900">{Number(day.day.slice(8))}</span>
                      <span className="block text-[10px] font-normal">{WEEKDAYS[weekdayOf(day.day)][0]}</span>
                    </th>
                  ))}
                  <th scope="col" className="min-w-12 border-b border-l border-slate-200 bg-slate-50 px-2 py-2 text-center font-medium text-emerald-800">
                    Present
                  </th>
                  <th scope="col" className="min-w-12 border-b border-slate-200 bg-slate-50 px-2 py-2 text-center font-medium text-blue-800">
                    Leave
                  </th>
                  <th scope="col" className="min-w-12 border-b border-slate-200 bg-slate-50 px-2 py-2 text-center font-medium text-red-800">
                    Absent
                  </th>
                </tr>
              </thead>
              <tbody>
                {people.map((person) => (
                  <tr key={person.user.id} className="group">
                    <th scope="row" className="sticky left-0 z-10 border-b border-r border-slate-200 bg-white px-3 py-1.5 text-left font-normal group-hover:bg-slate-50">
                      <span className="flex items-center gap-2">
                        <Avatar name={person.user.name} />
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium text-slate-900">{person.user.name}</span>
                          <span className="block truncate text-[11px] text-slate-500">{cap(person.user.role)}</span>
                        </span>
                      </span>
                    </th>
                    {person.days.map((day) => {
                      const style = dayStyle(day);
                      return (
                        <td key={day.day} className="border-b border-slate-100 p-0.5 text-center group-hover:bg-slate-50">
                          <button
                            type="button"
                            title={`${formatDay(day.day)}: ${style.label}${day.overrideNote ? ` (${day.overrideNote})` : ""}`}
                            aria-label={`Edit ${person.user.name} on ${formatDay(day.day)}: ${style.label}`}
                            onClick={() => openEdit(person, day)}
                            className={`relative size-8 rounded border text-[11px] font-semibold transition-shadow duration-200 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-1 ${style.cell}`}
                          >
                            {style.code}
                            {day.override && <span aria-hidden="true" className="absolute right-0.5 top-0.5 size-1.5 rounded-full bg-slate-700" />}
                          </button>
                        </td>
                      );
                    })}
                    <td className="border-b border-l border-slate-200 px-2 text-center font-semibold tabular-nums text-emerald-800">{person.summary.present + person.summary.halfDay / 2}</td>
                    <td className="border-b border-slate-200 px-2 text-center font-semibold tabular-nums text-blue-800">{person.summary.paidLeave + person.summary.unpaidLeave + person.summary.unsetLeave}</td>
                    <td className="border-b border-slate-200 px-2 text-center font-semibold tabular-nums text-red-800">{person.summary.absent}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <Legend />
        <p className="flex items-center gap-1.5 text-xs text-slate-700">
          <span className="size-1.5 rounded-full bg-slate-700" aria-hidden="true" /> Corrected by an admin
        </p>
      </div>

      {edit && (
        <Modal
          title={`Correct ${edit.person.user.name}`}
          description={`${formatDay(edit.day.day)}, currently ${dayStyle(edit.day).label.toLowerCase()}`}
          onClose={() => setEdit(null)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setEdit(null)}>
                Cancel
              </Button>
              <Button type="submit" form="override-form" icon={Save} loading={api.busy}>
                Save correction
              </Button>
            </>
          }
        >
          <form
            id="override-form"
            className="space-y-4"
            onSubmit={async (e) => {
              e.preventDefault();
              if (await api.mutate("admin/attendance", { userId: edit.person.user.id, date: edit.day.day, override: override || null, note }, "PUT")) setEdit(null);
            }}
          >
            <ErrorMessage error={api.error} />
            {(edit.day.checkInAt || edit.day.checkOutAt) && (
              <p className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-700">
                Recorded: in {formatTime(edit.day.checkInAt) || "none"}, out {formatTime(edit.day.checkOutAt) || "none"}
              </p>
            )}
            <Field label="Mark the day as" htmlFor="override-status" hint="Clear the override to go back to the recorded attendance.">
              <select id="override-status" className={inputClass} value={override} onChange={(e) => setOverride(e.target.value)}>
                <option value="">No override</option>
                <option value="present">Present</option>
                <option value="half_day">Half day</option>
                <option value="absent">Absent</option>
              </select>
            </Field>
            <Field label="Reason (optional)" htmlFor="override-note" hint={`${note.length}/300`}>
              <textarea id="override-note" maxLength={300} rows={2} className={`${inputClass} h-auto py-2 resize-y`} value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
          </form>
        </Modal>
      )}
    </AttendancePage>
  );
}
