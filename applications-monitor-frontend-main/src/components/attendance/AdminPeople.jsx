import { useMemo, useState } from "react";
import { Check, Copy, KeyRound, Pencil, Plus, Search, UserPlus, Users } from "lucide-react";
import { useAttendance } from "./useAttendance";
import { AttendancePage, Avatar, Badge, Button, Card, EmptyState, ErrorMessage, Field, Modal, Skeleton, inputClass } from "./shared";
import { DESIGNATIONS, ROLES, formatDay, roleLabel } from "./format";

const EMPTY = { name: "", email: "", otpEmail: "", role: "bda", designation: "", joinedOn: "", onboardingSubRole: "resume_maker" };
const STATUS = [
  ["active", "Active"],
  ["inactive", "Turned off"],
  ["all", "All"],
];
const ROLE_TONE = { admin: "bg-red-50 text-red-900 border-red-200", bda: "bg-violet-50 text-violet-900 border-violet-200" };

function Credentials({ result, onClose }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(result.temporaryPassword);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <Modal
      title={result.created ? "Person added" : "Password reset"}
      description={`${result.person.name || result.person.email} signs in with their work email and this password, then a code sent to ${result.person.otpEmail || result.person.email}.`}
      onClose={onClose}
      footer={<Button onClick={onClose}>I have saved it</Button>}
    >
      <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
        <p className="text-xs font-medium text-slate-600">Temporary password</p>
        <div className="mt-1 flex items-center justify-between gap-3">
          <code className="select-all text-lg font-semibold tracking-wide text-slate-900">{result.temporaryPassword}</code>
          <Button variant="secondary" size="sm" icon={copied ? Check : Copy} onClick={copy}>
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
      </div>
      <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">This is shown once. Only a hash is stored, so you cannot read it again. Share it privately, not in a group chat.</p>
    </Modal>
  );
}

function PersonForm({ initial, editing, api, onClose, onSaved }) {
  const [form, setForm] = useState(initial);
  const set = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));
  const role = ROLES.find((r) => r.value === form.role);
  return (
    <Modal
      title={editing ? "Edit person" : "Add a person"}
      description={editing ? editing.email : "They get an account and show up in attendance straight away."}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="person-form" icon={editing ? Check : UserPlus} loading={api.busy}>
            {editing ? "Save changes" : "Add person"}
          </Button>
        </>
      }
    >
      <form
        id="person-form"
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          const common = {
            name: form.name,
            otpEmail: form.otpEmail,
            role: form.role,
            designation: form.designation,
            joinedOn: form.joinedOn || null,
            ...(form.role === "onboarding_team" ? { onboardingSubRole: form.onboardingSubRole } : {}),
          };
          const result = editing ? await api.mutate(`admin/people/${editing.id}`, common, "PATCH") : await api.mutate("admin/people", { ...common, email: form.email }, "POST");
          if (result) onSaved(result, !editing);
        }}
      >
        <ErrorMessage error={api.error} />
        <Field label="Full name" htmlFor="person-name">
          <input id="person-name" required minLength={2} maxLength={80} className={inputClass} value={form.name} onChange={(e) => set("name", e.target.value)} autoComplete="off" />
        </Field>
        <Field label="Work email" htmlFor="person-email" hint={editing ? "The sign-in email cannot be changed." : "They sign in with this address."}>
          <input id="person-email" required type="email" disabled={!!editing} className={inputClass} value={form.email} onChange={(e) => set("email", e.target.value)} autoComplete="off" />
        </Field>
        <Field label="Email for login codes (optional)" htmlFor="person-otp" hint="Codes go here instead of the work email, for example a personal inbox. Leave empty to use the work email.">
          <input id="person-otp" type="email" className={inputClass} value={form.otpEmail} onChange={(e) => set("otpEmail", e.target.value)} autoComplete="off" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Designation" htmlFor="person-designation">
            <input id="person-designation" list="designations" maxLength={60} className={inputClass} value={form.designation} onChange={(e) => set("designation", e.target.value)} placeholder="Software Developer" />
            <datalist id="designations">
              {DESIGNATIONS.map((d) => (
                <option key={d} value={d} />
              ))}
            </datalist>
          </Field>
          <Field label="Joined on" htmlFor="person-joined">
            <input id="person-joined" type="date" className={inputClass} value={form.joinedOn} onChange={(e) => set("joinedOn", e.target.value)} />
          </Field>
        </div>
        <Field label="Portal access" htmlFor="person-role" hint={role?.hint}>
          <select id="person-role" className={inputClass} value={form.role} onChange={(e) => set("role", e.target.value)}>
            {ROLES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </Field>
        {form.role === "onboarding_team" && (
          <Field label="Onboarding work" htmlFor="person-sub">
            <select id="person-sub" className={inputClass} value={form.onboardingSubRole || "resume_maker"} onChange={(e) => set("onboardingSubRole", e.target.value)}>
              <option value="resume_maker">Resume maker</option>
              <option value="linkedin_and_cover_letter_optimization">LinkedIn and cover letter</option>
            </select>
          </Field>
        )}
      </form>
    </Modal>
  );
}

export default function AdminPeople() {
  const api = useAttendance("admin/people");
  const me = JSON.parse(localStorage.getItem("user") || "{}");
  const [status, setStatus] = useState("active");
  const [role, setRole] = useState("");
  const [query, setQuery] = useState("");
  const [dialog, setDialog] = useState(null); // {type: 'form'|'confirm'|'credentials', ...}

  const people = api.data?.people;
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (people || []).filter((p) => (status === "all" || (status === "active") === p.isActive) && (!role || p.role === role) && (!q || `${p.name} ${p.email} ${p.designation}`.toLowerCase().includes(q)));
  }, [people, status, role, query]);
  const activeCount = people?.filter((p) => p.isActive).length ?? 0;
  const close = () => setDialog(null);

  const toggle = async (person) => {
    if (await api.mutate(`admin/people/${person.id}`, { isActive: !person.isActive }, "PATCH")) close();
  };

  return (
    <AttendancePage
      title="People"
      subtitle={people ? `${activeCount} active, ${people.length - activeCount} turned off. Everyone here appears in attendance and approvals.` : "Add the team and manage their access."}
      admin
      actions={
        <Button icon={Plus} onClick={() => setDialog({ type: "form", initial: EMPTY })}>
          Add person
        </Button>
      }
    >
      <Card>
        <div className="flex flex-wrap items-end gap-4">
          <div className="min-w-56 flex-1">
            <Field label="Search" htmlFor="people-search">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                <input id="people-search" type="search" className={`${inputClass} pl-9`} placeholder="Name, email or designation" value={query} onChange={(e) => setQuery(e.target.value)} />
              </div>
            </Field>
          </div>
          <div className="w-44">
            <Field label="Access" htmlFor="people-role">
              <select id="people-role" className={inputClass} value={role} onChange={(e) => setRole(e.target.value)}>
                <option value="">All roles</option>
                {ROLES.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div>
            <p id="people-status-label" className="mb-1.5 text-sm font-medium text-slate-700">
              Status
            </p>
            <div role="group" aria-labelledby="people-status-label" className="flex h-10 items-center gap-1.5">
              {STATUS.map(([value, label]) => (
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
        </div>
      </Card>

      {!dialog && <ErrorMessage error={api.error} />}

      <Card className="overflow-hidden">
        {!people ? (
          <Skeleton className="h-48 w-full" />
        ) : shown.length === 0 ? (
          <EmptyState icon={Users} title={people.length === 0 ? "No people yet" : "Nobody matches"}>
            {people.length === 0 ? "Add the first person with the button above." : "Try a different search or filter."}
          </EmptyState>
        ) : (
          <div className="-m-5 overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium text-slate-600">
                  <th scope="col" className="px-4 py-2.5">Person</th>
                  <th scope="col" className="px-4 py-2.5">Designation</th>
                  <th scope="col" className="px-4 py-2.5">Access</th>
                  <th scope="col" className="px-4 py-2.5">Joined</th>
                  <th scope="col" className="px-4 py-2.5">Status</th>
                  <th scope="col" className="px-4 py-2.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {shown.map((person) => {
                  const self = person.email === me.email;
                  return (
                    <tr key={person.id} className={person.isActive ? "" : "bg-slate-50/70"}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <Avatar name={person.name || person.email} />
                          <div className="min-w-0">
                            <p className={`truncate font-medium ${person.isActive ? "text-slate-900" : "text-slate-500"}`}>
                              {person.name || person.email}
                              {self && <span className="ml-1.5 text-xs font-normal text-slate-500">(you)</span>}
                            </p>
                            <p className="truncate text-xs text-slate-600">{person.email}</p>
                            {person.otpEmail && <p className="truncate text-[11px] text-slate-500">Codes to {person.otpEmail}</p>}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-slate-800">{person.designation || <span className="text-slate-400">Not set</span>}</td>
                      <td className="px-4 py-3">
                        <Badge tone={ROLE_TONE[person.role]}>{roleLabel(person.role)}</Badge>
                      </td>
                      <td className="px-4 py-3 tabular-nums text-slate-700">{person.joinedOn ? formatDay(person.joinedOn, false) : formatDay(person.createdAt.slice(0, 10), false)}</td>
                      <td className="px-4 py-3">{person.isActive ? <Badge tone="bg-emerald-50 text-emerald-900 border-emerald-200">Active</Badge> : <Badge>Turned off</Badge>}</td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="secondary"
                            size="sm"
                            icon={Pencil}
                            onClick={() => setDialog({ type: "form", editing: person, initial: { name: person.name, email: person.email, otpEmail: person.otpEmail, role: person.role, designation: person.designation, joinedOn: person.joinedOn || "", onboardingSubRole: person.onboardingSubRole || "resume_maker" } })}
                          >
                            Edit
                          </Button>
                          <Button variant="secondary" size="sm" aria-label={`Reset password for ${person.name || person.email}`} title="Reset password" className="!px-2.5" onClick={() => setDialog({ type: "reset", person })}>
                            <KeyRound className="size-4" aria-hidden="true" />
                          </Button>
                          {!self && (
                            <Button variant={person.isActive ? "danger" : "secondary"} size="sm" onClick={() => (person.isActive ? setDialog({ type: "confirm", person }) : toggle(person))}>
                              {person.isActive ? "Turn off" : "Turn on"}
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {dialog?.type === "form" && (
        <>
          <PersonForm
            key={dialog.editing?.id || "new"}
            initial={dialog.initial}
            editing={dialog.editing}
            api={api}
            onClose={close}
            onSaved={(result, created) => (created ? setDialog({ type: "credentials", result: { ...result, created: true } }) : close())}
          />
        </>
      )}

      {dialog?.type === "confirm" && (
        <Modal
          title={`Turn off ${dialog.person.name || dialog.person.email}?`}
          description="They are signed out of attendance at once and can no longer sign in. Their history stays, and you can turn them back on."
          onClose={close}
          footer={
            <>
              <Button variant="secondary" onClick={close}>
                Cancel
              </Button>
              <Button variant="danger" loading={api.busy} onClick={() => toggle(dialog.person)}>
                Turn off
              </Button>
            </>
          }
        >
          <ErrorMessage error={api.error} />
        </Modal>
      )}

      {dialog?.type === "reset" && (
        <Modal
          title={`Reset password for ${dialog.person.name || dialog.person.email}?`}
          description="Their old password stops working now. You get a new temporary password to hand over."
          onClose={close}
          footer={
            <>
              <Button variant="secondary" onClick={close}>
                Cancel
              </Button>
              <Button icon={KeyRound} loading={api.busy} onClick={async () => {
                const result = await api.mutate(`admin/people/${dialog.person.id}/reset-password`, undefined, "POST");
                if (result) setDialog({ type: "credentials", result: { ...result, created: false } });
              }}>
                Reset password
              </Button>
            </>
          }
        >
          <ErrorMessage error={api.error} />
        </Modal>
      )}

      {dialog?.type === "credentials" && <Credentials result={dialog.result} onClose={close} />}
    </AttendancePage>
  );
}
