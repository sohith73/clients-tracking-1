import { useEffect, useRef } from "react";
import { AlertCircle, CheckCircle2, Loader2, X } from "lucide-react";
import { NavLink, Navigate, useOutletContext } from "react-router-dom";
import { LEAVE_STATUS, initials } from "./format";

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2";

export const inputClass = `w-full h-10 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 transition-colors duration-200 hover:border-slate-400 disabled:opacity-40 ${FOCUS}`;
export const labelClass = "block text-sm font-medium text-slate-700 mb-1.5";

/** Page frame: title, tab bar for the attendance area, and the content column. */
export function AttendancePage({ title, subtitle, admin = false, actions, children }) {
  const { user } = useOutletContext();
  if (admin && user?.role !== "admin") return <Navigate to="/attendance" replace />;
  const tabs = [
    { to: "/attendance", label: "Today", end: true },
    { to: "/attendance/leaves", label: "My leaves" },
    ...(user?.role === "admin"
      ? [
          { to: "/attendance/admin", label: "Overview", end: true },
          { to: "/attendance/admin/leaves", label: "Approvals" },
          { to: "/attendance/admin/grid", label: "Grid" },
          { to: "/attendance/admin/people", label: "People" },
          { to: "/attendance/admin/settings", label: "Settings" },
        ]
      : []),
  ];
  return (
    <main className="min-h-screen bg-slate-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">{title}</h1>
            {subtitle && <p className="mt-1 text-sm text-slate-600">{subtitle}</p>}
          </div>
          {actions}
        </header>
        <nav aria-label="Attendance" className="border-b border-slate-200 max-sm:overflow-x-auto [scrollbar-width:none]">
          <ul className="flex gap-1 sm:min-w-0 max-sm:min-w-max">
            {tabs.map((tab, index) => (
              <li key={tab.to} className={user?.role === "admin" && index === 2 ? "ml-4 pl-4 border-l border-slate-200" : ""}>
                <NavLink
                  to={tab.to}
                  end={tab.end}
                  className={({ isActive }) =>
                    `inline-flex items-center h-10 px-3 text-sm font-medium border-b-2 -mb-px transition-colors duration-200 ${FOCUS} ${
                      isActive ? "border-blue-600 text-blue-700" : "border-transparent text-slate-600 hover:text-slate-900 hover:border-slate-300"
                    }`
                  }
                >
                  {tab.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        {children}
      </div>
    </main>
  );
}

const VARIANTS = {
  primary: "bg-blue-600 text-white hover:bg-blue-700 active:bg-blue-800",
  secondary: "bg-white text-slate-800 border border-slate-300 hover:bg-slate-50 active:bg-slate-100",
  danger: "bg-white text-red-700 border border-red-300 hover:bg-red-50 active:bg-red-100",
  success: "bg-emerald-600 text-white hover:bg-emerald-700 active:bg-emerald-800",
};

export function Button({ variant = "primary", size = "md", loading = false, icon: Icon, children, className = "", disabled, type = "button", ...props }) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center gap-2 rounded-md font-medium whitespace-nowrap transition-colors duration-200 disabled:opacity-40 disabled:cursor-not-allowed ${FOCUS} ${
        size === "sm" ? "h-8 px-3 text-xs" : "h-10 px-4 text-sm"
      } ${VARIANTS[variant]} ${className}`}
      {...props}
    >
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : Icon ? <Icon className="size-4" aria-hidden="true" /> : null}
      {children}
    </button>
  );
}

export function Card({ title, description, action, children, className = "" }) {
  return (
    <section className={`bg-white border border-slate-200 rounded-lg shadow-sm ${className}`}>
      {(title || action) && (
        <div className="flex items-start justify-between gap-3 px-5 pt-5">
          <div>
            {title && <h2 className="text-base font-semibold text-slate-900">{title}</h2>}
            {description && <p className="mt-0.5 text-sm text-slate-600">{description}</p>}
          </div>
          {action}
        </div>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}

export function StatTile({ label, value, tone = "text-slate-900", hint }) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg px-4 py-3 shadow-sm">
      <p className="text-xs font-medium text-slate-600">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${tone}`}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

export function Badge({ children, tone = "bg-slate-100 text-slate-700 border-slate-200" }) {
  return <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${tone}`}>{children}</span>;
}

export function LeaveStatusBadge({ status }) {
  const style = LEAVE_STATUS[status] || LEAVE_STATUS.cancelled;
  return <Badge tone={style.tone}>{style.label}</Badge>;
}

export function Avatar({ name }) {
  return (
    <span aria-hidden="true" className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold text-slate-700">
      {initials(name)}
    </span>
  );
}

export function ErrorMessage({ error }) {
  if (!error) return null;
  const text =
    error.status === 401
      ? "Your session has ended. Sign out and sign in again."
      : error.status === 403
        ? "You do not have permission for this action."
        : error.message || "Something went wrong. Try again.";
  return (
    <div role="alert" className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800">
      <AlertCircle className="size-4 mt-0.5 shrink-0" aria-hidden="true" />
      <span>{text}</span>
    </div>
  );
}

export function Notice({ children }) {
  return (
    <div role="status" className="flex items-start gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-800">
      <CheckCircle2 className="size-4 mt-0.5 shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </div>
  );
}

export function Field({ label, htmlFor, hint, children }) {
  return (
    <div>
      <label htmlFor={htmlFor} className={labelClass}>
        {label}
      </label>
      {children}
      {hint && <p className="mt-1.5 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

export function EmptyState({ icon: Icon, title, children }) {
  return (
    <div className="flex flex-col items-center text-center py-12 px-4">
      {Icon && (
        <span className="mb-3 inline-flex size-12 items-center justify-center rounded-full bg-slate-100 text-slate-500">
          <Icon className="size-6" aria-hidden="true" />
        </span>
      )}
      <p className="text-base font-medium text-slate-900">{title}</p>
      {children && <p className="mt-1 max-w-sm text-sm text-slate-600">{children}</p>}
    </div>
  );
}

export function Skeleton({ className = "" }) {
  return <div aria-hidden="true" className={`animate-pulse rounded-md bg-slate-200 ${className}`} />;
}

/** Native <dialog> so focus trapping, Escape and the backdrop come from the browser. */
export function Modal({ title, description, children, onClose, footer }) {
  const ref = useRef(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return (
    <dialog
      ref={ref}
      onCancel={onClose}
      onClick={(event) => event.target === ref.current && onClose()}
      aria-labelledby="attendance-modal-title"
      className="m-auto w-[calc(100%-2rem)] max-w-md rounded-lg border border-slate-200 bg-white p-0 shadow-xl backdrop:bg-slate-900/50"
    >
      <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
        <div>
          <h2 id="attendance-modal-title" className="text-base font-semibold text-slate-900">
            {title}
          </h2>
          {description && <p className="mt-0.5 text-sm text-slate-600">{description}</p>}
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className={`-mr-1.5 -mt-1 inline-flex size-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-800 ${FOCUS}`}>
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>
      <div className="space-y-4 px-5 py-4">{children}</div>
      {footer && <div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3 rounded-b-lg">{footer}</div>}
    </dialog>
  );
}
