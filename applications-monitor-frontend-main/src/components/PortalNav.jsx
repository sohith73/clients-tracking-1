import React from 'react';
import { Link, useLocation } from 'react-router-dom';

// One navigation bar for the whole portal. App renders it above the routed page,
// so it stays mounted while the user clicks around. Each page used to wrap itself
// in <Layout> to get this bar, which meant it vanished on pages that did not wrap
// and re-mounted (with an empty role) on every navigation to the ones that did.
// Tailwind only generates class names it can see as full strings, so every colour
// below is spelled out instead of being built with a template literal.
const ITEMS = {
  clients: { to: '/monitor-clients', label: 'Clients', tone: 'bg-blue-600 hover:bg-blue-700', dot: 'border-blue-600' },
  plan: { to: '/client-dashboard', label: 'Plan', tone: 'bg-purple-600 hover:bg-purple-700', dot: 'border-purple-600' },
  register: { to: '/clients/new', label: 'Register Client', tone: 'bg-orange-600 hover:bg-orange-700', dot: 'border-orange-600' },
  managers: { to: '/manager-dashboard', label: 'Manager Dashboard', tone: 'bg-purple-600 hover:bg-purple-700', dot: 'border-purple-600' },
  analysis: { to: '/client-job-analysis', label: 'Client Job Analysis', tone: 'bg-teal-600 hover:bg-teal-700', dot: 'border-teal-600' },
  scheduler: { to: '/call-scheduler', label: 'Call Scheduler', tone: 'bg-emerald-600 hover:bg-emerald-700', dot: 'border-emerald-600' },
  extension: { to: '/extension-jobs-report', label: 'Extension Report', tone: 'bg-orange-600 hover:bg-orange-700', dot: 'border-orange-600' },
  performance: { to: '/operators-performance-report', label: 'Operators Performance', tone: 'bg-indigo-600 hover:bg-indigo-700', dot: 'border-indigo-600' },
  performanceReport: { to: '/operators-performance-report', label: 'Operators Performance Report', tone: 'bg-indigo-600 hover:bg-indigo-700', dot: 'border-indigo-600' },
  onboarding: { to: '/client-onboarding', label: 'Client Onboarding', tone: 'bg-sky-600 hover:bg-sky-700', dot: 'border-sky-600' },
};

/** Which items a user sees. Same rules the old Layout used, keyed off the logged-in user. */
function navItemsFor(user) {
  const role = user?.role;
  const isCsm = role === 'csm' || (Array.isArray(user?.roles) && user.roles.includes('csm'));
  const isTeamLead = role === 'team_lead';
  const isOpsIntern = role === 'operations_intern';

  if (isOpsIntern || isTeamLead || isCsm) {
    const keys = [];
    if (isOpsIntern) keys.push('performanceReport');
    if (isTeamLead || isCsm) keys.push('analysis', 'extension', 'performanceReport');
    if (isCsm) keys.push('onboarding');
    return [...new Set(keys)].map((key) => ITEMS[key]);
  }
  return ['clients', 'plan', 'register', 'managers', 'analysis', 'scheduler', 'performance'].map((key) => ITEMS[key]);
}

export default function PortalNav({ user }) {
  const { pathname } = useLocation();
  const items = navItemsFor(user);
  if (items.length === 0) return null;

  const isActive = (path) => {
    if (path === '/monitor-clients') return pathname === '/monitor-clients' || pathname === '/monitor' || pathname === '/';
    return pathname === path || pathname.startsWith(`${path}/`);
  };

  return (
    <nav aria-label="Portal" className="w-full border-b border-slate-200 bg-gradient-to-r from-blue-50 via-indigo-50 to-blue-50">
      <div className="p-3 flex flex-wrap gap-2.5 justify-center">
        {items.map((item) => {
          const active = isActive(item.to);
          return (
            <Link
              key={item.label}
              to={item.to}
              aria-current={active ? 'page' : undefined}
              className={`px-4 py-2.5 text-sm rounded-lg transition-all duration-300 font-semibold relative text-white ${item.tone} ${
                active ? 'shadow-xl scale-105 ring-2 ring-offset-2 ring-offset-blue-50 ring-white/40 border-2 border-white/50' : 'hover:shadow-md'
              }`}
            >
              {active && <span className={`absolute -top-1 -right-1 w-3 h-3 bg-white rounded-full border-2 ${item.dot}`} />}
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
