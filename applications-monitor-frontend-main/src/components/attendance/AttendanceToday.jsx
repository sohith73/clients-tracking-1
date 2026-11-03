import { useState } from "react";
import { CalendarCheck, LogIn, LogOut } from "lucide-react";
import { useAttendance } from "./useAttendance";
import { AttendancePage, Badge, Button, Card, ErrorMessage, Skeleton } from "./shared";
import { Legend, MonthNav, SummaryTiles } from "./parts";
import { WEEKDAYS, currentMonth, dayStyle, formatDay, formatTime, weekdayOf } from "./format";

function TimeBox({ label, value }) {
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3">
      <p className="text-xs font-medium text-slate-600">{label}</p>
      <p className={`mt-1 text-lg font-semibold tabular-nums ${value ? "text-slate-900" : "text-slate-400"}`}>{value || "Not yet"}</p>
    </div>
  );
}

export default function AttendanceToday() {
  const [month, setMonth] = useState(currentMonth);
  const today = useAttendance("today");
  const calendar = useAttendance(`month?month=${month}`);
  const act = async (action) => {
    if (await today.mutate(action)) calendar.refresh();
  };
  const shift = today.data?.today;
  const days = calendar.data?.person?.days;

  return (
    <AttendancePage title="Attendance" subtitle="Check in when you start and check out when you finish. Times are in IST.">
      <ErrorMessage error={today.error || calendar.error} />

      <Card
        title="Today"
        description={shift ? formatDay(shift.date) : undefined}
        action={
          today.data?.leaveToday ? (
            <Badge tone="bg-blue-50 text-blue-900 border-blue-200">
              {today.data.leaveToday.halfDay ? "Half day" : "Full day"} leave, {today.data.leaveToday.payType || "pay not set"}
            </Badge>
          ) : today.data?.offReason ? (
            <Badge>{today.data.offReason}</Badge>
          ) : null
        }
      >
        {shift ? (
          <div className="flex flex-wrap items-end gap-4">
            <div className="grid grid-cols-2 gap-3 w-full sm:w-auto sm:min-w-80">
              <TimeBox label="Checked in" value={formatTime(shift.checkInAt)} />
              <TimeBox label="Checked out" value={formatTime(shift.checkOutAt)} />
            </div>
            <div className="flex gap-3">
              <Button icon={LogIn} loading={today.busy && !shift.checkInAt} disabled={today.busy || !!shift.checkInAt} onClick={() => act("check-in")}>
                Check in
              </Button>
              <Button variant="secondary" icon={LogOut} loading={today.busy && !!shift.checkInAt && !shift.checkOutAt} disabled={today.busy || !shift.checkInAt || !!shift.checkOutAt} onClick={() => act("check-out")}>
                Check out
              </Button>
            </div>
          </div>
        ) : (
          <Skeleton className="h-16 w-full max-w-md" />
        )}
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-slate-900">Your month</h2>
        <MonthNav month={month} onChange={setMonth} />
      </div>

      {calendar.data?.person ? <SummaryTiles summary={calendar.data.person.summary} /> : <Skeleton className="h-20 w-full" />}

      <Card>
        {days ? (
          <div className="space-y-4">
            <div className="overflow-x-auto">
              <div className="grid grid-cols-7 gap-1.5 min-w-[640px]">
                {WEEKDAYS.map((name) => (
                  <p key={name} className="pb-1 text-center text-xs font-medium text-slate-600">
                    {name}
                  </p>
                ))}
                {Array.from({ length: weekdayOf(days[0].day) }, (_, i) => (
                  <span aria-hidden="true" key={`blank-${i}`} />
                ))}
                {days.map((cell) => {
                  const style = dayStyle(cell);
                  const checkIn = formatTime(cell.checkInAt);
                  const checkOut = formatTime(cell.checkOutAt);
                  return (
                    <article key={cell.day} aria-label={`${formatDay(cell.day)}: ${style.label}`} className={`min-h-24 rounded-md border p-2 text-xs ${style.cell}`}>
                      <p className="text-sm font-semibold tabular-nums">{Number(cell.day.slice(8))}</p>
                      <p className="mt-0.5 font-medium">{cell.holiday || style.label}</p>
                      {cell.leave?.halfDay && <p>Half day</p>}
                      {checkIn && (
                        <p className="mt-1 tabular-nums opacity-80">
                          {checkIn}
                          {checkOut ? ` to ${checkOut}` : ""}
                        </p>
                      )}
                      {cell.overrideNote && <p className="mt-1 italic opacity-80">{cell.overrideNote}</p>}
                    </article>
                  );
                })}
              </div>
            </div>
            <Legend />
          </div>
        ) : (
          <Skeleton className="h-64 w-full" />
        )}
      </Card>
      {days && days.every((d) => d.status === "upcoming" || d.status === "before_joining") && (
        <p className="flex items-center gap-2 text-sm text-slate-600">
          <CalendarCheck className="size-4" aria-hidden="true" /> Nothing recorded for this month yet.
        </p>
      )}
    </AttendancePage>
  );
}
