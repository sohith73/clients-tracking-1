import { useState } from "react";
import { Check, Inbox, Undo2, X, Wallet } from "lucide-react";
import { useAttendance } from "./useAttendance";
import { AttendancePage, Avatar, Badge, Button, Card, EmptyState, ErrorMessage, Field, LeaveStatusBadge, Modal, Skeleton, inputClass } from "./shared";
import { cap, formatRange } from "./format";

const STATUSES = [
  ["pending", "Pending"],
  ["approved", "Approved"],
  ["rejected", "Rejected"],
  ["cancelled", "Cancelled"],
  ["all", "All"],
];

const ACTIONS = {
  approve: { title: "Approve leave", confirm: "Approve", variant: "success", icon: Check, pay: true, note: true },
  reject: { title: "Reject leave", confirm: "Reject", variant: "danger", icon: X, note: true },
  set_pay: { title: "Change pay type", confirm: "Save", variant: "primary", icon: Wallet, pay: true },
  revoke: { title: "Revoke approval", confirm: "Revoke", variant: "danger", icon: Undo2, note: true },
};

export default function AdminLeaves() {
  const [status, setStatus] = useState("pending");
  const [month, setMonth] = useState("");
  const [userId, setUserId] = useState("");
  const [decision, setDecision] = useState(null);
  const [payType, setPayType] = useState("paid");
  const [note, setNote] = useState("");
  const api = useAttendance(`admin/leaves?${new URLSearchParams({ status, ...(month ? { month } : {}), ...(userId ? { userId } : {}) })}`);
  const people = useAttendance("admin/attendance");
  const meta = decision && ACTIONS[decision.action];

  const open = (leave, action) => {
    setDecision({ leave, action });
    setNote("");
    setPayType(leave.payType || "paid");
  };

  return (
    <AttendancePage title="Leave approvals" subtitle="Approve or reject requests, and mark approved leave paid or unpaid." admin>
      <Card>
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <p className="mb-1.5 text-sm font-medium text-slate-700" id="status-filter-label">Status</p>
          <div role="group" aria-labelledby="status-filter-label" className="flex h-10 flex-wrap items-center gap-1.5">
            {STATUSES.map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={status === value}
                onClick={() => setStatus(value)}
                className={`h-8 rounded-md border px-3 text-xs font-medium transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 ${
                  status === value ? "border-blue-600 bg-blue-600 text-white" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          </div>
          <div className="w-52">
            <Field label="Employee" htmlFor="filter-employee">
              <select id="filter-employee" className={inputClass} value={userId} onChange={(e) => setUserId(e.target.value)}>
                <option value="">All employees</option>
                {people.data?.people.map((p) => (
                  <option key={p.user.id} value={p.user.id}>
                    {p.user.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="w-44">
            <Field label="Month" htmlFor="filter-month">
              <input id="filter-month" type="month" className={inputClass} value={month} onChange={(e) => setMonth(e.target.value)} />
            </Field>
          </div>
          {(month || userId) && (
            <Button
              variant="secondary"
              onClick={() => {
                setMonth("");
                setUserId("");
              }}
            >
              Clear filters
            </Button>
          )}
        </div>
      </Card>

      {!decision && <ErrorMessage error={api.error} />}

      {!api.data ? (
        <Skeleton className="h-32 w-full" />
      ) : api.data.leaves.length === 0 ? (
        <Card>
          <EmptyState icon={Inbox} title={status === "pending" ? "Nothing waiting for you" : "No matching requests"}>
            {status === "pending" ? "New leave requests appear here as soon as someone sends one." : "Try another status or clear the filters."}
          </EmptyState>
        </Card>
      ) : (
        <ul className="space-y-3">
          {api.data.leaves.map((leave) => (
            <li key={leave.id} className="bg-white border border-slate-200 rounded-lg p-4 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="flex min-w-0 gap-3">
                  <Avatar name={leave.user.name} />
                  <div className="min-w-0 space-y-1">
                    <p className="text-sm font-semibold text-slate-900">
                      {leave.user.name} <span className="font-normal text-slate-600">{formatRange(leave.fromDate, leave.toDate)}</span>
                    </p>
                    <p className="text-xs text-slate-600">
                      {cap(leave.type)} leave, {leave.dayCount} {leave.dayCount === 1 ? "day" : "days"}
                      {leave.halfDay ? " (half day)" : ""}
                    </p>
                    <p className="text-sm text-slate-800">{leave.reason}</p>
                    {leave.decisionNote && <p className="text-xs italic text-slate-600">Note: {leave.decisionNote}</p>}
                    {leave.decidedBy && <p className="text-xs text-slate-500">Decided by {leave.decidedBy.name}</p>}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-3">
                  <div className="flex items-center gap-2">
                    {leave.status === "approved" && leave.payType && <Badge tone={leave.payType === "paid" ? "bg-blue-50 text-blue-900 border-blue-200" : "bg-orange-50 text-orange-900 border-orange-200"}>{cap(leave.payType)}</Badge>}
                    <LeaveStatusBadge status={leave.status} />
                  </div>
                  <div className="flex gap-2">
                    {leave.status === "pending" && (
                      <>
                        <Button size="sm" variant="success" icon={Check} onClick={() => open(leave, "approve")}>
                          Approve
                        </Button>
                        <Button size="sm" variant="danger" icon={X} onClick={() => open(leave, "reject")}>
                          Reject
                        </Button>
                      </>
                    )}
                    {leave.status === "approved" && (
                      <>
                        <Button size="sm" variant="secondary" icon={Wallet} onClick={() => open(leave, "set_pay")}>
                          Change pay
                        </Button>
                        <Button size="sm" variant="danger" icon={Undo2} onClick={() => open(leave, "revoke")}>
                          Revoke
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {decision && (
        <Modal
          title={meta.title}
          description={`${decision.leave.user.name}, ${formatRange(decision.leave.fromDate, decision.leave.toDate)}`}
          onClose={() => setDecision(null)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setDecision(null)}>
                Cancel
              </Button>
              <Button type="submit" form="decision-form" variant={meta.variant} icon={meta.icon} loading={api.busy}>
                {meta.confirm}
              </Button>
            </>
          }
        >
          <form
            id="decision-form"
            className="space-y-4"
            onSubmit={async (e) => {
              e.preventDefault();
              const body = { action: decision.action, ...(meta.pay ? { payType } : {}), ...(meta.note ? { note } : {}) };
              if (await api.mutate(`admin/leaves/${decision.leave.id}`, body, "PATCH")) setDecision(null);
            }}
          >
            <ErrorMessage error={api.error} />
            {meta.pay && (
              <Field label="Pay type" htmlFor="decision-pay" hint="Paid leave keeps salary. Unpaid leave is deducted.">
                <select id="decision-pay" className={inputClass} value={payType} onChange={(e) => setPayType(e.target.value)}>
                  <option value="paid">Paid</option>
                  <option value="unpaid">Unpaid</option>
                </select>
              </Field>
            )}
            {meta.note && (
              <Field label="Note to the employee (optional)" htmlFor="decision-note" hint={`${note.length}/500`}>
                <textarea id="decision-note" maxLength={500} rows={3} className={`${inputClass} h-auto py-2 resize-y`} value={note} onChange={(e) => setNote(e.target.value)} />
              </Field>
            )}
            {decision.action === "revoke" && <p className="text-sm text-slate-600">The leave is cancelled and the employee is emailed.</p>}
          </form>
        </Modal>
      )}
    </AttendancePage>
  );
}
