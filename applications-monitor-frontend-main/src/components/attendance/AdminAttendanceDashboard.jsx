import { Link } from "react-router-dom";
import { ArrowRight, UserCheck, UserMinus, Plane } from "lucide-react";
import { useAttendance } from "./useAttendance";
import { AttendancePage, Avatar, Badge, Card, EmptyState, ErrorMessage, Skeleton, StatTile } from "./shared";
import { cap, formatDay, formatTime } from "./format";

const GROUPS = [
  { key: "checkedIn", title: "Checked in", icon: UserCheck, empty: "Nobody has checked in yet." },
  { key: "onLeave", title: "On leave", icon: Plane, empty: "Nobody is on leave today." },
  { key: "notMarked", title: "Not marked yet", icon: UserMinus, empty: "Everyone is accounted for." },
];

export default function AdminAttendanceDashboard() {
  const api = useAttendance("admin/overview");
  const data = api.data;
  const pending = data?.pendingLeaves ?? data?.counts?.pendingLeaves ?? 0;

  return (
    <AttendancePage title="Overview" subtitle={data ? `${formatDay(data.today)}${data.isOffDay ? ", weekly off or holiday" : ""}` : "Who is in, away, or missing today."} admin>
      <ErrorMessage error={api.error} />

      {data ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatTile label="Checked in" value={data.checkedIn.length} tone="text-emerald-700" />
          <StatTile label="On leave" value={data.onLeave.length} tone="text-blue-700" />
          <StatTile label="Not marked yet" value={data.notMarked.length} tone="text-amber-700" />
          <Link to="/attendance/admin/leaves" className="group block rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2">
            <div className="h-full bg-white border border-slate-200 rounded-lg px-4 py-3 shadow-sm transition-colors duration-200 group-hover:border-blue-300">
              <p className="text-xs font-medium text-slate-600">Pending approvals</p>
              <p className={`mt-1 text-2xl font-semibold tabular-nums ${pending ? "text-red-700" : "text-slate-900"}`}>{pending}</p>
              <p className="mt-0.5 flex items-center gap-1 text-xs font-medium text-blue-700">
                Review <ArrowRight className="size-3" aria-hidden="true" />
              </p>
            </div>
          </Link>
        </div>
      ) : (
        <Skeleton className="h-24 w-full" />
      )}

      <div className="grid gap-4 lg:grid-cols-3 items-start">
        {GROUPS.map(({ key, title, icon: Icon, empty }) => (
          <Card key={key} title={title} action={data && <Badge>{data[key].length}</Badge>}>
            {!data ? (
              <Skeleton className="h-24 w-full" />
            ) : data[key].length === 0 ? (
              <EmptyState icon={Icon} title={empty} />
            ) : (
              <ul className="divide-y divide-slate-100 -my-2">
                {data[key].map((item) => {
                  const person = item.user || item;
                  return (
                    <li key={person.id} className="flex items-center gap-3 py-2.5">
                      <Avatar name={person.name} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-slate-900">{person.name}</p>
                        <p className="truncate text-xs text-slate-600">{person.email}</p>
                      </div>
                      {item.checkInAt && <span className="text-xs tabular-nums text-slate-700">{formatTime(item.checkInAt)}</span>}
                      {key === "onLeave" && <Badge>{item.halfDay ? "Half day" : cap(item.payType || "pay not set")}</Badge>}
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        ))}
      </div>
    </AttendancePage>
  );
}
