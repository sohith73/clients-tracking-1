import { useState } from "react";
import { CalendarOff, Send } from "lucide-react";
import { useAttendance } from "./useAttendance";
import { AttendancePage, Badge, Button, Card, EmptyState, ErrorMessage, Field, LeaveStatusBadge, Notice, Skeleton, inputClass } from "./shared";
import { LEAVE_TYPES, cap, formatRange } from "./format";

const EMPTY = { type: "casual", fromDate: "", toDate: "", halfDay: false, reason: "" };

export default function MyLeaves() {
  const api = useAttendance("leaves");
  const [form, setForm] = useState(EMPTY);
  const [sent, setSent] = useState(false);
  const sameDay = form.fromDate && form.fromDate === form.toDate;
  const set = (name, value) => {
    setSent(false);
    setForm((prev) => {
      const next = { ...prev, [name]: value };
      if (name === "fromDate" && (!next.toDate || next.toDate < value)) next.toDate = value;
      if (next.fromDate !== next.toDate) next.halfDay = false;
      return next;
    });
  };

  return (
    <AttendancePage title="My leaves" subtitle="Request time off. An admin approves it and marks it paid or unpaid.">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,380px)_1fr] items-start">
        <Card title="Request leave">
          <form
            className="space-y-4"
            onSubmit={async (e) => {
              e.preventDefault();
              if (await api.mutate("leaves", form)) {
                setForm(EMPTY);
                setSent(true);
              }
            }}
          >
            <Field label="Type" htmlFor="leave-type">
              <select id="leave-type" className={inputClass} value={form.type} onChange={(e) => set("type", e.target.value)}>
                {LEAVE_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="From" htmlFor="leave-from">
                <input id="leave-from" required type="date" className={inputClass} value={form.fromDate} onChange={(e) => set("fromDate", e.target.value)} />
              </Field>
              <Field label="To" htmlFor="leave-to">
                <input id="leave-to" required type="date" min={form.fromDate || undefined} className={inputClass} value={form.toDate} onChange={(e) => set("toDate", e.target.value)} />
              </Field>
            </div>
            <label className={`flex items-center gap-2 text-sm ${sameDay ? "text-slate-800" : "text-slate-400"}`}>
              <input type="checkbox" className="size-4 rounded border-slate-300 accent-blue-600" disabled={!sameDay} checked={form.halfDay} onChange={(e) => set("halfDay", e.target.checked)} />
              Half day
              <span className="text-xs text-slate-500">{sameDay ? "" : "(pick a single date)"}</span>
            </label>
            <Field label="Reason" htmlFor="leave-reason" hint={`${form.reason.length}/1000`}>
              <textarea
                id="leave-reason"
                required
                minLength={3}
                maxLength={1000}
                rows={3}
                className={`${inputClass} h-auto py-2 resize-y`}
                value={form.reason}
                onChange={(e) => set("reason", e.target.value)}
                placeholder="A short reason helps the admin decide quickly"
              />
            </Field>
            <ErrorMessage error={api.error} />
            {sent && !api.error && <Notice>Request sent. Admins have been emailed.</Notice>}
            <Button type="submit" icon={Send} loading={api.busy} className="w-full">
              Send request
            </Button>
          </form>
        </Card>

        <div className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900">Your requests</h2>
          {!api.data ? (
            <Skeleton className="h-28 w-full" />
          ) : api.data.leaves.length === 0 ? (
            <Card>
              <EmptyState icon={CalendarOff} title="No leave requests yet">
                Requests you send show up here with their status.
              </EmptyState>
            </Card>
          ) : (
            api.data.leaves.map((leave) => (
              <article key={leave.id} className="bg-white border border-slate-200 rounded-lg p-4 shadow-sm space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-slate-900">{formatRange(leave.fromDate, leave.toDate)}</h3>
                  <div className="flex items-center gap-2">
                    {leave.status === "approved" && leave.payType && <Badge tone={leave.payType === "paid" ? "bg-blue-50 text-blue-900 border-blue-200" : "bg-orange-50 text-orange-900 border-orange-200"}>{cap(leave.payType)}</Badge>}
                    <LeaveStatusBadge status={leave.status} />
                  </div>
                </div>
                <p className="text-xs text-slate-600">
                  {cap(leave.type)} leave, {leave.dayCount} {leave.dayCount === 1 ? "day" : "days"}
                  {leave.halfDay ? " (half day)" : ""}
                </p>
                <p className="text-sm text-slate-800">{leave.reason}</p>
                {leave.decidedBy && (
                  <p className="text-xs text-slate-600">
                    {leave.status === "approved" ? "Approved" : leave.status === "rejected" ? "Rejected" : "Decided"} by {leave.decidedBy.name}
                    {leave.decisionNote ? `: "${leave.decisionNote}"` : ""}
                  </p>
                )}
                {leave.status === "pending" && (
                  <Button variant="secondary" size="sm" disabled={api.busy} onClick={() => api.mutate(`leaves/${leave.id}/cancel`)}>
                    Withdraw request
                  </Button>
                )}
              </article>
            ))
          )}
        </div>
      </div>
    </AttendancePage>
  );
}
