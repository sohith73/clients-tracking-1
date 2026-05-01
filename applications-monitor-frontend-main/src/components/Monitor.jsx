import React, { useMemo, useState, useEffect, useRef } from "react";
import ClientDetails from "./ClientDetails";
import OperationsDetails from "./OperationsDetails";
import RegisterClient from "./RegisterClient";
import {Link, useNavigate, useOutletContext} from 'react-router-dom';
import { AnimatedCounter } from "./AnimatedCounter";
import { hasLinkedInOptimization, hasCoverLetter, planFeatureLabel } from "../utils/planFeatures";

const API_BASE = import.meta.env.VITE_BASE || "https://applications-monitor-api.flashfirejobs.com";

// Validate required environment variables
if (!API_BASE) {
  console.error('❌ VITE_BASE environment variable is required');
}

// ---------------- API ----------------
async function fetchJobsForClient(email) {
    const res = await fetch(`${API_BASE}/api/clients/${encodeURIComponent(email)}/jobs`);
    if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
    const data = await res.json();
    return Array.isArray(data.jobs) ? data.jobs : [];
}

async function fetchAllClients() {
    const res = await fetch(`${API_BASE}/api/clients`);
    if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
    const data = await res.json();
    return Array.isArray(data.clients) ? data.clients : [];
}

async function fetchDashboardManagers() {
    const res = await fetch(`${API_BASE}/api/managers/public`);
    if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
    const data = await res.json();
    return Array.isArray(data.managers) ? data.managers : [];
}

// ---------------- Helpers ----------------
function parseFlexibleDate(input) {
  if (!input) return null;

  // Try dd/mm/yyyy format first
  const m = String(input).trim().match(
    /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})(?:[,\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?)?$/i
  );

  if (m) {
    let [, d, mo, y, h = "0", mi = "0", s = "0", ap] = m;
    d = +d; mo = +mo - 1; y = +y; h = +h; mi = +mi; s = +s;
    if (ap) {
      const isPM = ap.toLowerCase() === "pm";
      if (h === 12) h = isPM ? 12 : 0;
      else if (isPM) h += 12;
    }
    return new Date(y, mo, d, h, mi, s);
  }

  // If input is already a Date or ISO string
  const native = new Date(input);
  return isNaN(native.getTime()) ? null : native;
}

function formatDate(dt) {
  if (!dt) return "—";
  return dt.toLocaleDateString("en-GB"); // forces dd/mm/yyyy
}

function formatDateTime(dt) {
  if (!dt) return "—";
  return dt.toLocaleString("en-GB", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

// Cached formatRelativeTime — avoids redundant new Date() + math for the same input across 500+ rows.
// Cache auto-clears every 30s so "X minutes ago" stays fresh.
const _relTimeCache = new Map();
let _relTimeCacheTs = Date.now();

function formatRelativeTime(dateInput) {
  if (!dateInput) return "—";

  // Clear cache every 30s so relative times stay accurate
  const now = Date.now();
  if (now - _relTimeCacheTs > 30000) {
    _relTimeCache.clear();
    _relTimeCacheTs = now;
  }

  const key = typeof dateInput === 'string' ? dateInput : String(dateInput);
  const cached = _relTimeCache.get(key);
  if (cached !== undefined) return cached;

  const date = parseFlexibleDate(dateInput);
  if (!date || isNaN(date.getTime())) { _relTimeCache.set(key, "—"); return "—"; }

  const diffMs = now - date.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);
  const diffMonths = Math.floor(diffDays / 30);
  const diffYears = Math.floor(diffDays / 365);

  let result;
  if (diffSeconds < 60) {
    result = diffSeconds <= 0 ? "just now" : `${diffSeconds} second${diffSeconds === 1 ? '' : 's'} ago`;
  } else if (diffMinutes < 60) {
    result = `${diffMinutes} minute${diffMinutes === 1 ? '' : 's'} ago`;
  } else if (diffHours < 24) {
    result = `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
  } else if (diffDays < 30) {
    result = `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
  } else if (diffMonths < 12) {
    result = `${diffMonths} month${diffMonths === 1 ? '' : 's'} ago`;
  } else {
    result = `${diffYears} year${diffYears === 1 ? '' : 's'} ago`;
  }

  _relTimeCache.set(key, result);
  return result;
}



function sameDay(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function getLastTimelineStatus(timeline = []) {
  if (!timeline.length) return null;
  const last = timeline[timeline.length - 1];
  if (typeof last === "string") return last.toLowerCase();
  if (last && typeof last === "object" && last.status)
    return String(last.status).toLowerCase();
  return null;
}

function isAppliedNow(job) {
  const current = String(job.currentStatus || "").toLowerCase();
  const last = getLastTimelineStatus(job.timeline);
  // Consider job applied if either current status OR last timeline entry indicates applied
  const currentApplied = current.includes("appl");
  const lastApplied = !!last && last.includes("appl");
  return currentApplied || lastApplied;
}

function sortByUpdatedDesc(a, b) {
  const da = parseFlexibleDate(a.updatedAt || a.dateAdded);
  const db = parseFlexibleDate(b.updatedAt || b.dateAdded);
  const ta = da ? da.getTime() : 0;
  const tb = db ? db.getTime() : 0;
  return tb - ta;
}

function safeDate(job) {
  return parseFlexibleDate(job.appliedDate || job.updatedAt || job.dateAdded);
}

// Status mapping to standardize status names
function mapStatusToStandard(status) {
  const normalizedStatus = String(status || "").toLowerCase();
  
  // Handle statuses with "by user" or "by intern" suffixes
  if (normalizedStatus.includes('applied')) return 'applied';
  if (normalizedStatus.includes('saved')) return 'saved';
  if (normalizedStatus.includes('interviewing')) return 'interviewing';
  if (normalizedStatus.includes('rejected')) return 'rejected';
  if (normalizedStatus.includes('deleted')) return 'removed';
  if (normalizedStatus.includes('offer') || normalizedStatus.includes('hired')) return 'offers';
  if (normalizedStatus.includes('on-hold')) return 'interviewing';
  
  // Fallback to exact mapping for other statuses
  const statusMap = {
    'offer': 'offers',
    'hired': 'offers', // Treat hired as offers
    'on-hold': 'interviewing', // Treat on-hold as interviewing
    'deleted': 'removed', // Map deleted to removed
    'saved': 'saved',
    'applied': 'applied',
    'interviewing': 'interviewing',
    'rejected': 'rejected'
  };
  
  return statusMap[normalizedStatus] || normalizedStatus;
}

// Status counters: { saved: 5, applied: 10, interviewing: 4, offers: 2, rejected: 3, removed: 1 }
function getStatusCounts(jobs = []) {
  const counts = {};
  for (const j of jobs) {
    const s = mapStatusToStandard(j.currentStatus);
    counts[s] = (counts[s] || 0) + 1;
  }
  return counts;
}

// ---------------- UI ----------------
function ClientList({ clients = [], selected, onSelect }) {
  return (
    <div className="w-64 border-r border-slate-200 p-3">
      <h3 className="mb-2 text-base font-semibold text-slate-800">Clients</h3>
      <div className="flex flex-col gap-2">
        {clients.map((c) => (
          <button
            key={c}
            onClick={() => onSelect(c)}
            className={`w-full truncate rounded-lg border px-3 py-2 text-left transition ${
              selected === c
                ? "border-slate-300 bg-slate-100 font-semibold"
                : "border-slate-200 bg-white hover:bg-slate-50"
            }`}
            title={c}
          >
            {c}
          </button>
        ))}
      </div>
    </div>
  );
}

function StatusBar({ counts = {}, dateAppliedCount = 0, filterDate, onStatusClick }) {
  // Always show common statuses, even if they have 0 counts
  const commonOrder = ["saved", "applied", "interviewing", "offers", "rejected", "removed"];
  
  // Create a complete status object with all common statuses, defaulting to 0
  const allStatuses = {};
  commonOrder.forEach(status => {
    allStatuses[status] = counts[status] || 0;
  });
  
  // Add any extra statuses that exist in counts but aren't in common order
  Object.keys(counts).forEach(status => {
    if (!commonOrder.includes(status)) {
      allStatuses[status] = counts[status];
    }
  });
  
  const keys = [
    ...commonOrder.filter((k) => allStatuses.hasOwnProperty(k)),
    ...Object.keys(allStatuses)
      .filter((k) => !commonOrder.includes(k))
      .sort(),
  ];
  
  return (
    <div className="sticky top-0 z-10 mb-3 w-full border border-slate-200 bg-white px-3 py-2 rounded-lg">
      <div className="flex flex-wrap items-center gap-2">
        {keys.length === 0 ? (
          <span className="text-xs text-slate-500">No jobs for this client.</span>
        ) : (
          keys.map((k) => {
            // Special handling for "applied" status when date is filtered
            const isAppliedWithDate = k === "applied" && filterDate && dateAppliedCount > 0;
            const displayCount = isAppliedWithDate ? dateAppliedCount : allStatuses[k];
            const title = isAppliedWithDate 
              ? `Applied on ${new Date(filterDate).toLocaleDateString('en-GB')}: ${dateAppliedCount} jobs`
              : `Click to view ${k} jobs`;
            
            return (
            <span
              key={k}
                className={`inline-flex items-center gap-1 rounded-full border border-slate-300 px-2 py-0.5 text-xs text-slate-700 ${
                  onStatusClick ? 'cursor-pointer hover:bg-slate-50 hover:border-slate-400 transition-colors' : ''
                } ${isAppliedWithDate ? 'border-blue-300 bg-blue-50' : ''} ${allStatuses[k] === 0 ? 'opacity-60' : ''}`}
                title={title}
                onClick={onStatusClick ? () => onStatusClick(k) : undefined}
            >
              <span className="capitalize">{k}</span>
                <span className={`rounded px-1.5 ${isAppliedWithDate ? 'bg-blue-200 text-blue-800 font-semibold' : allStatuses[k] === 0 ? 'bg-slate-200 text-slate-500' : 'bg-slate-100'}`}>
                  {displayCount}
                </span>
                {isAppliedWithDate && (
                  <span className="text-xs text-blue-600 font-medium">
                    (on {new Date(filterDate).toLocaleDateString('en-GB')})
                  </span>
                )}
            </span>
            );
          })
        )}

      </div>
    </div>
  );
}

function JobCard({ job, onJobClick }) {
  return (
    <div
      onClick={() => onJobClick(job)}
      className="cursor-pointer rounded-xl border border-slate-200 p-3 hover:bg-slate-50 transition-colors"
    >
      <div className="font-semibold">{job.jobTitle || "Untitled Role"}</div>
      <div className="mt-0.5 text-sm text-slate-600">
        {job.companyName || "Company"}
      </div>
    </div>
  );
}

function JobDetailsModal({ job, isOpen, onClose }) {
  if (!isOpen || !job) return null;

  const dt = safeDate(job);
  const when = formatRelativeTime(dt);

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-6xl h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-slate-200">
          <h2 className="text-2xl font-bold text-slate-900">
            {job.jobTitle || "Untitled Role"}
          </h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
          >
            <svg className="w-6 h-6 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 flex overflow-hidden">
          {/* Left Panel - Job Details */}
          <div className="w-1/3 border-r border-slate-200 p-6 overflow-y-auto">
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-semibold text-slate-700 mb-2">Company</h3>
                <p className="text-slate-900">{job.companyName || "Not specified"}</p>
              </div>
              
              <div>
                <h3 className="text-sm font-semibold text-slate-700 mb-2">Updated</h3>
                <p className="text-slate-900">{when}</p>
              </div>

              <div>
                <h3 className="text-sm font-semibold text-slate-700 mb-2">Status</h3>
                <p className="text-slate-900 capitalize">{job.currentStatus || "Unknown"}</p>
              </div>

              <div>
                <h3 className="text-sm font-semibold text-slate-700 mb-2">Job Link</h3>
                <a 
                  href={job.joblink} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:text-blue-800 underline break-all"
                >
                  {job.joblink || "Not available"}
                </a>
              </div>
            </div>
          </div>

          {/* Right Panel - Job Description */}
          <div className="flex-1 p-6 overflow-y-auto">
            <h3 className="text-lg font-semibold text-slate-700 mb-4">Job Description</h3>
            <div className="prose prose-sm max-w-none">
              {typeof job.jobDescription === "string" ? (
                <div className="whitespace-pre-wrap text-slate-700 leading-relaxed">
                  {job.jobDescription}
      </div>
              ) : (
                <div className="text-slate-500 italic">
                  No job description available
        </div>
      )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function CompactRow({ job }) {
  const dt = safeDate(job);
  const when = formatDate(dt);
  return (
    <div className="rounded-lg border border-slate-200 px-3 py-2">
      <div className="truncate text-sm font-semibold">
        {job.jobTitle || "Untitled Role"}
      </div>
      <div className="truncate text-xs text-slate-600">
        {(job.companyName || "Company") + " • " + when}
      </div>
    </div>
  );
}

// function ClientCard({ client, clientDetails, onSelect }) {
//   const details = typeof client === 'string' ? clientDetails[client] : client;
//   const email = typeof client === 'string' ? client : client?.email || '';
//   const displayName = details?.name || email?.split?.('@')?.[0] || '';
//   const initials = displayName
//     ?.split(' ')
//     .map(n => n?.charAt?.(0))
//     .join('')
//     ?.toUpperCase() || email?.charAt?.(0)?.toUpperCase() || '?';
//   const status = details?.status || 'active';
  
//   return (
//     <button
//       onClick={() => onSelect(client)}
//       className="w-full p-4 border border-slate-200 rounded-lg hover:bg-slate-50 hover:border-slate-300 transition-all text-left relative"
//     >
//       <div className="flex items-center gap-3">
//         <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
//           <span className="text-blue-600 font-semibold text-sm">
//             {initials}
//           </span>
//         </div>
//         <div className="flex-1 min-w-0">
//           <div className="font-medium text-slate-900 truncate">
//             {displayName}
//           </div>
//           <div className="text-sm text-slate-500 truncate">
//             {client}
//           </div>
//         </div>
//         {/* Status indicator */}
//         <div className={`w-3 h-3 rounded-full ${
//           status === 'active' ? 'bg-green-500' : 'bg-gray-400'
//         }`} title={`Status: ${status}`}></div>
//       </div>
//     </button>
//   );
// }

function ClientCard({ client, clientDetails, onSelect }) {
  // 🧠 Handle both "string" (email) and "object" forms
  const details = typeof client === "string" ? clientDetails[client] : client;
  const email =
    typeof client === "string" ? client : client?.email || "unknown@email.com";

  const displayName = details?.name || email?.split?.("@")?.[0] || "Unknown";
  const initials =
    displayName
      ?.split(" ")
      .map((n) => n?.charAt?.(0))
      .join("")
      ?.toUpperCase() || "?";

  const status = (details?.status === 'active' || details?.status === 'inactive') ? details.status : "active";
  const plan = details?.planType || "No plan";

  return (
    <button
      onClick={() => onSelect(email)}
      className="w-full p-4 border border-slate-200 rounded-lg hover:bg-slate-50 hover:border-slate-300 transition-all text-left relative"
    >
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
          <span className="text-blue-600 font-semibold text-sm">{initials}</span>
        </div>

        <div className="flex-1 min-w-0">
          {/* ✅ These are strings only */}
          <div className="font-medium text-slate-900 truncate">
            {displayName}
          </div>
          <div className="text-sm text-slate-500 truncate">{email}</div>
        </div>

        {/* Status indicator */}
        <div
          className={`w-3 h-3 rounded-full ${
            status === "active" ? "bg-green-500" : "bg-gray-400"
          }`}
          title={`Status: ${status}`}
        ></div>
      </div>

      {/* ✅ Plan text */}
      <div className="text-xs text-slate-500 mt-2 truncate">{plan}</div>
    </button>
  );
}

function OperationsTableRow({ operation, onSelect, performanceCount = 0, performanceDate, performanceEndDate }) {
  const [clientStats, setClientStats] = useState([]);
  const [savedCounts, setSavedCounts] = useState({});
  const [loadingClients, setLoadingClients] = useState(false);
  const [showClientStats, setShowClientStats] = useState(false);
  const displayName = operation.name || operation?.email?.split('@')[0];
  const initials = displayName?.split(' ').map(n => n.charAt(0)).join('').toUpperCase() || operation.email.charAt(0).toUpperCase();
  
  // Fetch client statistics for this operator
  useEffect(() => {
    const fetchClientStats = async () => {
      setLoadingClients(true);
      try {
        const params = new URLSearchParams();
        if (performanceDate) {
          params.append('startDate', performanceDate);
        }
        if (performanceEndDate) {
          params.append('endDate', performanceEndDate);
        }
        
        const response = await fetch(`${API_BASE}/api/operations/${encodeURIComponent(operation.email)}/client-stats?${params.toString()}`);
        if (response.ok) {
          const data = await response.json();
          setClientStats(data.clientStats || []);
          
          // Fetch saved counts for all clients
          if (data.clientStats && data.clientStats.length > 0) {
            const userEmails = data.clientStats.map(client => client.email);
            const savedResponse = await fetch(`${API_BASE}/api/operations/saved-counts`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({ userEmails })
            });
            
            if (savedResponse.ok) {
              const savedData = await savedResponse.json();
              setSavedCounts(savedData.savedCounts || {});
            }
          }
        }
      } catch (error) {
        console.error('Error fetching client stats:', error);
      } finally {
        setLoadingClients(false);
      }
    };
    
    fetchClientStats();
  }, [operation.email, performanceDate, performanceEndDate]);
  
  const totalApplied = clientStats.reduce((sum, client) => sum + client.appliedCount, 0);
  const totalSaved = Object.values(savedCounts).reduce((sum, count) => sum + count, 0);
  
  return (
    <tr className="hover:bg-slate-50 transition-colors">
      <td className="px-6 py-4 whitespace-nowrap">
        <div className="flex items-center">
          <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center flex-shrink-0 mr-3">
            <span className="text-green-600 font-semibold text-sm">
              {initials}
            </span>
          </div>
          <div>
            <div className="text-sm font-medium text-slate-900">
              {displayName}
            </div>
          </div>
        </div>
      </td>
      <td className="px-6 py-4 whitespace-nowrap">
        <div className="text-sm text-slate-500">
          {operation.email}
        </div>
      </td>
      <td className="px-6 py-4 whitespace-nowrap">
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 capitalize">
          {operation.role}
        </span>
      </td>
      <td className="px-6 py-4 whitespace-nowrap">
        <div className="text-sm text-slate-900">
          {loadingClients ? (
            <div className="flex items-center">
              <div className="w-4 h-4 border-2 border-slate-300 border-t-blue-500 rounded-full animate-spin mr-2"></div>
              <span className="text-slate-400">Loading...</span>
            </div>
          ) : (
            `${clientStats.length} client(s)`
          )}
        </div>
      </td>
      <td className="px-6 py-4 whitespace-nowrap">
        <div className="text-sm font-bold text-green-600">
          {performanceCount}
        </div>
      </td>
      <td className="px-6 py-4 whitespace-nowrap">
        <div className="text-sm font-bold text-slate-900">
          {totalApplied}
        </div>
      </td>
      <td className="px-6 py-4 whitespace-nowrap">
        <div className="text-sm font-bold text-purple-600">
          {totalSaved}
        </div>
      </td>
      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
        <button
          onClick={() => onSelect(operation)}
          className="text-green-600 hover:text-green-900 bg-green-50 hover:bg-green-100 px-3 py-1 rounded-md transition-colors"
        >
          View Details
        </button>
      </td>
    </tr>
  );
}

function OperationCard({ operation, onSelect, performanceCount = 0, performanceDate, performanceEndDate }) {
  const [clientStats, setClientStats] = useState([]);
  const [savedCounts, setSavedCounts] = useState({});
  const [loadingClients, setLoadingClients] = useState(false);
  const [showClientStats, setShowClientStats] = useState(false);
  const displayName = operation.name || operation?.email?.split('@')[0];
  const initials = displayName?.split(' ').map(n => n.charAt(0)).join('').toUpperCase() || operation.email.charAt(0).toUpperCase();
  
  // Fetch client statistics for this operator
  useEffect(() => {
    const fetchClientStats = async () => {
      setLoadingClients(true);
      try {
        const params = new URLSearchParams();
        if (performanceDate) {
          params.append('startDate', performanceDate);
        }
        if (performanceEndDate) {
          params.append('endDate', performanceEndDate);
        }
        
        const response = await fetch(`${API_BASE}/api/operations/${encodeURIComponent(operation.email)}/client-stats?${params.toString()}`);
        if (response.ok) {
          const data = await response.json();
          setClientStats(data.clientStats || []);
          
          // Fetch saved counts for all clients
          if (data.clientStats && data.clientStats.length > 0) {
            const userEmails = data.clientStats.map(client => client.email);
            const savedResponse = await fetch(`${API_BASE}/api/operations/saved-counts`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({ userEmails })
            });
            
            if (savedResponse.ok) {
              const savedData = await savedResponse.json();
              setSavedCounts(savedData.savedCounts || {});
            }
          }
        }
      } catch (error) {
        console.error('Error fetching client stats:', error);
      } finally {
        setLoadingClients(false);
      }
    };
    
    fetchClientStats();
  }, [operation.email, performanceDate, performanceEndDate]);
  
  const formatDateRange = () => {
    if (performanceDate === performanceEndDate) {
      return new Date(performanceDate).toLocaleDateString('en-GB');
    }
    return `${new Date(performanceDate).toLocaleDateString('en-GB')} - ${new Date(performanceEndDate).toLocaleDateString('en-GB')}`;
  };
  
  return (
    <button
      onClick={() => onSelect(operation)}
      className="w-full p-6 border border-slate-200 rounded-xl hover:bg-slate-50 hover:border-slate-300 transition-all text-left shadow-sm hover:shadow-md"
    >
      <div className="flex items-center gap-4">
        <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center flex-shrink-0">
          <span className="text-green-600 font-semibold text-lg">
            {initials}
          </span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-2">
            <div>
              <div className="font-semibold text-slate-900 text-lg mb-1">
                {displayName}
              </div>
              <div className="text-sm text-slate-500 mb-1">
                {operation.email}
              </div>
              <div className="text-xs text-slate-400 capitalize">
                {operation.role}
              </div>
            </div>
            <div className="text-right">
              <div className="text-sm text-slate-500 mb-1">
                Applied on {formatDateRange()}:
              </div>
              <div className="bg-green-100 text-green-800 text-lg font-bold px-3 py-1 rounded-full">
                {performanceCount}
              </div>
            </div>
          </div>
          
          {/* Client Statistics Section - Collapsible */}
          <div className="mt-3 pt-3 border-t border-slate-100">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setShowClientStats(!showClientStats);
              }}
              className="w-full flex items-center justify-between p-2 hover:bg-slate-50 rounded-lg transition-colors"
            >
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-slate-600">Clients:</span>
                {loadingClients ? (
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 border-2 border-slate-300 border-t-blue-500 rounded-full animate-spin"></div>
                    <span className="text-sm text-slate-400">Loading...</span>
                  </div>
                ) : (
                  <span className="text-sm text-slate-500">{clientStats.length} client(s)</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {!loadingClients && clientStats.length > 0 && (
                  <div className="flex items-center gap-2 text-xs">
                    <div className="flex items-center gap-1">
                      <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                      <span className="text-slate-500">
                        {clientStats.reduce((sum, client) => sum + client.appliedCount, 0)} applied
                      </span>
                    </div>
                    <div className="flex items-center gap-1">
                      <div className="w-2 h-2 bg-purple-500 rounded-full"></div>
                      <span className="text-slate-500">
                        {Object.values(savedCounts).reduce((sum, count) => sum + count, 0)} saved
                      </span>
                    </div>
                  </div>
                )}
                <svg 
                  className={`w-4 h-4 text-slate-400 transition-transform duration-200 ${
                    showClientStats ? 'rotate-180' : ''
                  }`}
                  fill="none" 
                  stroke="currentColor" 
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </button>
            
            {/* Collapsible Content */}
            <div className={`transition-all duration-300 ease-in-out ${
              showClientStats ? 'max-h-96 opacity-100' : 'max-h-0 opacity-0'
            }`}>
              {loadingClients ? (
                <div className="text-sm text-slate-400 py-2">Loading client statistics...</div>
              ) : clientStats.length > 0 ? (
                <div className="mt-2 max-h-80 overflow-y-auto space-y-2 pr-2">
                  {clientStats.map((client, index) => (
                    <div 
                      key={index}
                      className="flex items-center justify-between bg-blue-50 rounded-lg p-3 border border-blue-200"
                    >
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 bg-blue-100 rounded-full flex items-center justify-center">
                          <span className="text-blue-600 font-semibold text-xs">
                            {client.name.charAt(0).toUpperCase()}
                          </span>
                        </div>
                        <span className="text-sm font-medium text-slate-700">
                          {client.name}
                        </span>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="text-center">
                          <div className="text-xs text-slate-500">Applied</div>
                          <div className="text-sm font-bold text-green-600">{client.appliedCount}</div>
                        </div>
                        <div className="text-center">
                          <div className="text-xs text-slate-500">Saved</div>
                          <div className="text-sm font-bold text-purple-600">{savedCounts[client.email] || 0}</div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-sm text-slate-400 py-2">No clients assigned</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </button>
  );
}

function ClientDetailsSection({ clientEmail, clientDetails, onClientUpdate, userRole = 'admin', dashboardManagers = [], loadingManagers = false, onStatusUpdate }) {
  const [isEditing, setIsEditing] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    dashboardTeamLeadName: '',
    dashboardInternName: '',
    planType: '',
    onboardingDate: '',
    jobDeadline: '',
    applicationStartDate: '',
    whatsappGroupMade: false,
    whatsappGroupMadeDate: '',
    dashboardCredentialsShared: false,
    dashboardCredentialsSharedDate: '',
    resumeSent: false,
    resumeSentDate: '',
    coverLetterSent: false,
    coverLetterSentDate: '',
    portfolioMade: false,
    portfolioMadeDate: '',
    linkedinOptimization: false,
    linkedinOptimizationDate: '',
    status: 'active'
  });

  // Update form data when clientDetails change
  useEffect(() => {
    if (clientDetails) {
      setFormData({
        name: clientDetails.name || '',
        dashboardTeamLeadName: clientDetails.dashboardTeamLeadName || '',
        dashboardInternName: clientDetails.dashboardInternName || '',
        planType: clientDetails.planType || '',
        onboardingDate: clientDetails.onboardingDate || '',
        jobDeadline: clientDetails.jobDeadline || '',
        applicationStartDate: clientDetails.applicationStartDate || '',
        whatsappGroupMade: clientDetails.whatsappGroupMade || false,
        whatsappGroupMadeDate: clientDetails.whatsappGroupMadeDate || '',
        dashboardCredentialsShared: clientDetails.dashboardCredentialsShared || false,
        dashboardCredentialsSharedDate: clientDetails.dashboardCredentialsSharedDate || '',
        resumeSent: clientDetails.resumeSent || false,
        resumeSentDate: clientDetails.resumeSentDate || '',
        coverLetterSent: clientDetails.coverLetterSent || false,
        coverLetterSentDate: clientDetails.coverLetterSentDate || '',
        portfolioMade: clientDetails.portfolioMade || false,
        portfolioMadeDate: clientDetails.portfolioMadeDate || '',
        linkedinOptimization: clientDetails.linkedinOptimization || false,
        linkedinOptimizationDate: clientDetails.linkedinOptimizationDate || '',
        status: (clientDetails.status === 'active' || clientDetails.status === 'inactive') ? clientDetails.status : 'active'
      });
    }
  }, [clientDetails]);

  const handleInputChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value
    }));
  };

  const handleSave = async () => {
    try {
      const saveData = {
        email: clientEmail,
        ...formData,
        status: (formData.status === 'active' || formData.status === 'inactive') 
          ? formData.status 
          : ((clientDetails?.status === 'active' || clientDetails?.status === 'inactive') ? clientDetails.status : 'active'),
        currentPath: window.location.pathname
      };
      
      const response = await fetch(`${API_BASE}/api/clients`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(saveData)
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        setIsEditing(false);
        console.error('Save failed - HTTP Status:', response.status, 'Response:', errorData);
        alert(`Save failed (HTTP ${response.status}): ${errorData.error || errorData.message || 'Please check console for details'}`);
        return;
      }
      
      const result = await response.json();
      const updatedClient = result.updatedClientsTracking || result.client;
      
      setIsEditing(false);
      
      if (updatedClient) {
        if (typeof onClientUpdate === 'function') {
          onClientUpdate(clientEmail, updatedClient);
        }
        
        if (onStatusUpdate && typeof onStatusUpdate === 'function') {
          onStatusUpdate();
        }
      } else {
        console.warn('Save successful but no client data returned:', result);
      }
    } catch (error) {
      console.error('Error saving client details:', error);
      setIsEditing(false);
      alert(`Network error: ${error.message}. Please check your connection and try again.`);
    }
  };

  const handleCancel = () => {
    // Reset form data to original values
    if (clientDetails) {
      setFormData({
        name: clientDetails.name || '',
        dashboardTeamLeadName: clientDetails.dashboardTeamLeadName || '',
        dashboardInternName: clientDetails.dashboardInternName || '',
        planType: clientDetails.planType || '',
        onboardingDate: clientDetails.onboardingDate || '',
        jobDeadline: clientDetails.jobDeadline || '',
        whatsappGroupMade: clientDetails.whatsappGroupMade || false,
        whatsappGroupMadeDate: clientDetails.whatsappGroupMadeDate || '',
        dashboardCredentialsShared: clientDetails.dashboardCredentialsShared || false,
        dashboardCredentialsSharedDate: clientDetails.dashboardCredentialsSharedDate || '',
        resumeSent: clientDetails.resumeSent || false,
        resumeSentDate: clientDetails.resumeSentDate || '',
        coverLetterSent: clientDetails.coverLetterSent || false,
        coverLetterSentDate: clientDetails.coverLetterSentDate || '',
        portfolioMade: clientDetails.portfolioMade || false,
        portfolioMadeDate: clientDetails.portfolioMadeDate || '',
        linkedinOptimization: clientDetails.linkedinOptimization || false,
        linkedinOptimizationDate: clientDetails.linkedinOptimizationDate || ''
      });
    }
    setIsEditing(false);
  };

  if (!clientDetails) {
    return (
      <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
        <div className="text-sm text-slate-600">
          <span className="font-medium">Client Details:</span> No profile information available. 
          <span className="text-blue-600 ml-1">Click "Personal Details" to add information.</span>
        </div>
      </div>
    );
  }

  const formatDate = (dateString) => {
    if (!dateString || dateString === "") return "Not set";
    try {
      // Handle different date formats
      let date;
      if (dateString.includes('/')) {
        // Handle format like "9/7/2025, 1:55:57 PM"
        date = new Date(dateString);
      } else if (dateString.includes('-')) {
        // Handle format like "2025-11-01"
        date = new Date(dateString);
      } else {
        // Try parsing as is
        date = new Date(dateString);
      }
      
      if (isNaN(date.getTime())) {
        return "Invalid date";
      }
      
      return date.toLocaleDateString('en-GB');
    } catch {
      return "Invalid date";
    }
  };

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4 shadow-md">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-slate-700">Client Information</h3>
        <div className="flex gap-2">
          {isEditing ? (
            <>
              <button
                onClick={handleSave}
                className="px-3 py-1.5 text-xs font-medium text-white bg-green-600 border border-green-600 rounded-lg hover:bg-green-700 transition-colors"
              >
                Save
              </button>
              <button
                onClick={handleCancel}
                className="px-3 py-1.5 text-xs font-medium text-gray-600 bg-gray-100 border border-gray-300 rounded-lg hover:bg-gray-200 transition-colors"
              >
                Cancel
              </button>
            </>
          ) : (
            userRole === 'admin' ? (
              <button
                onClick={() => setIsEditing(true)}
                className="px-3 py-1.5 text-xs font-medium text-blue-600 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 hover:border-blue-300 transition-colors"
              >
                Edit Details
              </button>
            ) : (
              <span className="px-3 py-1.5 text-xs font-medium text-slate-400 bg-slate-100 border border-slate-200 rounded-lg">
                View Only
              </span>
            )
          )}
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <div>
          <label className="text-xs font-medium text-slate-500 uppercase tracking-wide">Team Lead</label>
          {isEditing ? (
            <select
              name="dashboardTeamLeadName"
              value={formData.dashboardTeamLeadName}
              onChange={handleInputChange}
              disabled={loadingManagers}
              className="w-full mt-1 px-2 py-1 text-sm border border-slate-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="">Select Manager</option>
              {dashboardManagers.map((manager) => (
                <option key={manager._id} value={manager.fullName}>
                  {manager.fullName}
                </option>
              ))}
            </select>
          ) : (
            <p className="text-sm text-slate-900 mt-1">
              {clientDetails.dashboardManager || "Not specified"}
            </p>
          )}
        </div>
        <div>
          <label className="text-xs font-medium text-slate-500 uppercase tracking-wide">Intern Name</label>
          {isEditing ? (
            <input
              type="text"
              name="dashboardInternName"
              value={formData.dashboardInternName}
              onChange={handleInputChange}
              className="w-full mt-1 px-2 py-1 text-sm border border-slate-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          ) : (
            <p className="text-sm text-slate-900 mt-1">
              {clientDetails.dashboardInternName || "Not specified"}
            </p>
          )}
        </div>
        <div>
          <label className="text-xs font-medium text-slate-500 uppercase tracking-wide">Plan Type</label>
          {isEditing ? (
            <select
              name="planType"
              value={formData.planType}
              onChange={handleInputChange}
              className="w-full mt-1 px-2 py-1 text-sm border border-slate-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="">Select Plan</option>
              <option value="ignite">Ignite</option>
              <option value="professional">Professional</option>
              <option value="executive">Executive</option>
              <option value="prime">Prime</option>
            </select>
          ) : (
            <p className="text-sm text-slate-900 mt-1">
              {clientDetails.planType || "Not specified"}
            </p>
          )}
        </div>
        <div>
          <label className="text-xs font-medium text-slate-500 uppercase tracking-wide">Onboarding Date</label>
          {isEditing ? (
            <input
              type="date"
              name="onboardingDate"
              value={formData.onboardingDate}
              onChange={handleInputChange}
              className="w-full mt-1 px-2 py-1 text-sm border border-slate-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          ) : (
            <p className="text-sm text-slate-900 mt-1">
              {formatDate(clientDetails.onboardingDate)}
            </p>
          )}
        </div>
        <div>
          <label className="text-xs font-medium text-slate-500 uppercase tracking-wide">Job Deadline</label>
          {isEditing ? (
            <input
              type="date"
              name="jobDeadline"
              value={formData.jobDeadline}
              onChange={handleInputChange}
              className="w-full mt-1 px-2 py-1 text-sm border border-slate-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          ) : (
            <p className="text-sm text-slate-900 mt-1">
              {formatDate(clientDetails.jobDeadline)}
            </p>
          )}
        </div>
        <div>
          <label className="text-xs font-medium text-slate-500 uppercase tracking-wide">Application Start Date</label>
          {isEditing ? (
            <input
              type="date"
              name="applicationStartDate"
              value={formData.applicationStartDate}
              onChange={handleInputChange}
              className="w-full mt-1 px-2 py-1 text-sm border border-slate-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          ) : (
            <p className="text-sm text-slate-900 mt-1">
              {formatDate(clientDetails.applicationStartDate)}
            </p>
          )}
        </div>
        <div>
          <label className="text-xs font-medium text-slate-500 uppercase tracking-wide">Status</label>
          {isEditing ? (
            <select
              name="status"
              value={formData.status}
              onChange={handleInputChange}
              className="w-full mt-1 px-2 py-1 text-sm border border-slate-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          ) : (
            <p className={`text-sm mt-1 font-medium ${
              clientDetails.status === 'active' ? 'text-green-600' : 'text-gray-500'
            }`}>
              {clientDetails.status === 'active' ? 'Active' : 'Inactive'}
            </p>
          )}
        </div>
        <div>
          <label className="text-xs font-medium text-slate-500 uppercase tracking-wide">Client Name</label>
          {isEditing ? (
            <input
              type="text"
              name="name"
              value={formData.name}
              onChange={handleInputChange}
              className="w-full mt-1 px-2 py-1 text-sm border border-slate-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          ) : (
            <p className="text-sm text-slate-900 mt-1">
              {clientDetails.name || clientEmail?.split('@')[0]}
            </p>
          )}
        </div>
      </div>
      
      {/* Task Checklist Section */}
      <div className="mt-6 pt-4 border-t border-slate-200">
        <h4 className="text-sm font-semibold text-slate-700 mb-3">Task Checklist</h4>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          <div className="flex flex-col space-y-1">
            <div className="flex items-center space-x-2">
              {isEditing ? (
                <input
                  type="checkbox"
                  name="whatsappGroupMade"
                  checked={formData.whatsappGroupMade}
                  onChange={handleInputChange}
                  className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 focus:ring-2"
                />
              ) : (
                <div className="w-3 h-3 rounded-full flex items-center justify-center">
                  {clientDetails.whatsappGroupMade ? (
                    <div className="w-3 h-3 bg-green-500 rounded-full"></div>
                  ) : (
                    <div className="w-3 h-3 bg-gray-300 rounded-full"></div>
                  )}
                </div>
              )}
              <span className="text-xs text-slate-600">WhatsApp Group</span>
            </div>
            {isEditing ? (
              <input
                type="date"
                name="whatsappGroupMadeDate"
                value={formData.whatsappGroupMadeDate}
                onChange={handleInputChange}
                className="text-xs px-2 py-1 border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
              />
            ) : (
              <span className="text-xs text-slate-500 ml-5">
                {clientDetails.whatsappGroupMadeDate ? new Date(clientDetails.whatsappGroupMadeDate).toLocaleDateString('en-GB') : 'Not set'}
              </span>
            )}
          </div>
          
          <div className="flex flex-col space-y-1">
            <div className="flex items-center space-x-2">
              {isEditing ? (
                <input
                  type="checkbox"
                  name="dashboardCredentialsShared"
                  checked={formData.dashboardCredentialsShared}
                  onChange={handleInputChange}
                  className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 focus:ring-2"
                />
              ) : (
                <div className="w-3 h-3 rounded-full flex items-center justify-center">
                  {clientDetails.dashboardCredentialsShared ? (
                    <div className="w-3 h-3 bg-green-500 rounded-full"></div>
                  ) : (
                    <div className="w-3 h-3 bg-gray-300 rounded-full"></div>
                  )}
                </div>
              )}
              <span className="text-xs text-slate-600">Dashboard Credentials</span>
            </div>
            {isEditing ? (
              <input
                type="date"
                name="dashboardCredentialsSharedDate"
                value={formData.dashboardCredentialsSharedDate}
                onChange={handleInputChange}
                className="text-xs px-2 py-1 border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
              />
            ) : (
              <span className="text-xs text-slate-500 ml-5">
                {clientDetails.dashboardCredentialsSharedDate ? new Date(clientDetails.dashboardCredentialsSharedDate).toLocaleDateString('en-GB') : 'Not set'}
              </span>
            )}
          </div>
          
          <div className="flex flex-col space-y-1">
            <div className="flex items-center space-x-2">
              {isEditing ? (
                <input
                  type="checkbox"
                  name="resumeSent"
                  checked={formData.resumeSent}
                  onChange={handleInputChange}
                  className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 focus:ring-2"
                />
              ) : (
                <div className="w-3 h-3 rounded-full flex items-center justify-center">
                  {clientDetails.resumeSent ? (
                    <div className="w-3 h-3 bg-green-500 rounded-full"></div>
                  ) : (
                    <div className="w-3 h-3 bg-gray-300 rounded-full"></div>
                  )}
                </div>
              )}
              <span className="text-xs text-slate-600">Resume Sent</span>
            </div>
            {isEditing ? (
              <input
                type="date"
                name="resumeSentDate"
                value={formData.resumeSentDate}
                onChange={handleInputChange}
                className="text-xs px-2 py-1 border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
              />
            ) : (
              <span className="text-xs text-slate-500 ml-5">
                {clientDetails.resumeSentDate ? new Date(clientDetails.resumeSentDate).toLocaleDateString('en-GB') : 'Not set'}
              </span>
            )}
          </div>
          
          <div className={`flex flex-col space-y-1 ${!hasCoverLetter(formData.planType) ? 'opacity-75 bg-gray-50 rounded p-2 border border-gray-200' : ''}`} title={!hasCoverLetter(formData.planType) ? planFeatureLabel('coverLetter') : undefined}>
            <div className="flex items-center space-x-2">
              {isEditing ? (
                <input
                  type="checkbox"
                  name="coverLetterSent"
                  checked={formData.coverLetterSent}
                  onChange={handleInputChange}
                  disabled={!hasCoverLetter(formData.planType)}
                  className={`w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 focus:ring-2 ${!hasCoverLetter(formData.planType) ? 'cursor-not-allowed opacity-60' : ''}`}
                />
              ) : (
                <div className="w-3 h-3 rounded-full flex items-center justify-center">
                  {clientDetails.coverLetterSent ? (
                    <div className="w-3 h-3 bg-green-500 rounded-full"></div>
                  ) : (
                    <div className={`w-3 h-3 rounded-full ${hasCoverLetter(formData.planType) ? 'bg-gray-300' : 'bg-gray-200'}`}></div>
                  )}
                </div>
              )}
              <span className={`text-xs ${hasCoverLetter(formData.planType) ? 'text-slate-600' : 'text-gray-500'}`}>Cover Letter{!hasCoverLetter(formData.planType) && ' (not in plan)'}</span>
            </div>
            {isEditing ? (
              <input
                type="date"
                name="coverLetterSentDate"
                value={formData.coverLetterSentDate}
                onChange={handleInputChange}
                disabled={!hasCoverLetter(formData.planType)}
                className={`text-xs px-2 py-1 border rounded focus:ring-1 ${hasCoverLetter(formData.planType) ? 'border-slate-300 focus:ring-blue-500 focus:border-blue-500' : 'border-gray-200 bg-gray-100 text-gray-500 cursor-not-allowed'}`}
              />
            ) : (
              <span className="text-xs text-slate-500 ml-5">
                {clientDetails.coverLetterSentDate ? new Date(clientDetails.coverLetterSentDate).toLocaleDateString('en-GB') : 'Not set'}
              </span>
            )}
          </div>
          
          <div className="flex flex-col space-y-1">
            <div className="flex items-center space-x-2">
              {isEditing ? (
                <input
                  type="checkbox"
                  name="portfolioMade"
                  checked={formData.portfolioMade}
                  onChange={handleInputChange}
                  className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 focus:ring-2"
                />
              ) : (
                <div className="w-3 h-3 rounded-full flex items-center justify-center">
                  {clientDetails.portfolioMade ? (
                    <div className="w-3 h-3 bg-green-500 rounded-full"></div>
                  ) : (
                    <div className="w-3 h-3 bg-gray-300 rounded-full"></div>
                  )}
                </div>
              )}
              <span className="text-xs text-slate-600">Portfolio Made</span>
            </div>
            {isEditing ? (
              <input
                type="date"
                name="portfolioMadeDate"
                value={formData.portfolioMadeDate}
                onChange={handleInputChange}
                className="text-xs px-2 py-1 border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
              />
            ) : (
              <span className="text-xs text-slate-500 ml-5">
                {clientDetails.portfolioMadeDate ? new Date(clientDetails.portfolioMadeDate).toLocaleDateString('en-GB') : 'Not set'}
              </span>
            )}
          </div>
          
          <div className={`flex flex-col space-y-1 ${!hasLinkedInOptimization(formData.planType) ? 'opacity-75 bg-gray-50 rounded p-2 border border-gray-200' : ''}`} title={!hasLinkedInOptimization(formData.planType) ? planFeatureLabel('linkedin') : undefined}>
            <div className="flex items-center space-x-2">
              {isEditing ? (
                <input
                  type="checkbox"
                  name="linkedinOptimization"
                  checked={formData.linkedinOptimization}
                  onChange={handleInputChange}
                  disabled={!hasLinkedInOptimization(formData.planType)}
                  className={`w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 focus:ring-2 ${!hasLinkedInOptimization(formData.planType) ? 'cursor-not-allowed opacity-60' : ''}`}
                />
              ) : (
                <div className="w-3 h-3 rounded-full flex items-center justify-center">
                  {clientDetails.linkedinOptimization ? (
                    <div className="w-3 h-3 bg-green-500 rounded-full"></div>
                  ) : (
                    <div className={`w-3 h-3 rounded-full ${hasLinkedInOptimization(formData.planType) ? 'bg-gray-300' : 'bg-gray-200'}`}></div>
                  )}
                </div>
              )}
              <span className={`text-xs ${hasLinkedInOptimization(formData.planType) ? 'text-slate-600' : 'text-gray-500'}`}>LinkedIn Optimization{!hasLinkedInOptimization(formData.planType) && ' (not in plan)'}</span>
            </div>
            {isEditing ? (
              <input
                type="date"
                name="linkedinOptimizationDate"
                value={formData.linkedinOptimizationDate}
                onChange={handleInputChange}
                disabled={!hasLinkedInOptimization(formData.planType)}
                className={`text-xs px-2 py-1 border rounded focus:ring-1 ${hasLinkedInOptimization(formData.planType) ? 'border-slate-300 focus:ring-blue-500 focus:border-blue-500' : 'border-gray-200 bg-gray-100 text-gray-500 cursor-not-allowed'}`}
              />
            ) : (
              <span className="text-xs text-slate-500 ml-5">
                {clientDetails.linkedinOptimizationDate ? new Date(clientDetails.linkedinOptimizationDate).toLocaleDateString('en-GB') : 'Not set'}
              </span>
            )}
          </div>
        </div>
      </div>

    </div>
  );
}

function RightAppliedColumn({ jobs = [], title = "Applied" }) {
  const sorted = useMemo(() => [...jobs].sort(sortByUpdatedDesc), [jobs]);
  return (
    <div className="w-64 border-l border-slate-200 p-3 bg-white shadow-sm">
      <h3 className="mb-2 text-base font-semibold text-slate-800">
        {title} <span className="text-slate-500">({sorted.length})</span>
      </h3>
      <div className="flex max-h-[calc(100vh-10rem)] flex-col gap-2 overflow-y-auto">
        {sorted.map((j) => (
          <CompactRow key={j._id || j.jobID || `${j.userID}-${j.joblink}`} job={j} />
        ))}
      </div>
    </div>
  );
}

// ---------------- Main Component ----------------
export default function Monitor({ onClose }) {
  const [jobs, setJobs] = useState([]);
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [selectedClient, setSelectedClient] = useState(null);
  const [filterDate, setFilterDate] = useState(""); // yyyy-mm-dd
  // Initialize based on user role - operations_intern should default to operations view
  const user = JSON.parse(localStorage.getItem('user') || '{}');
  const isOperationsIntern = user?.role === 'operations_intern';
  const [showClients, setShowClients] = useState(!isOperationsIntern);
  const [showClientDetails, setShowClientDetails] = useState(false);
  const [clientDetailsEmail, setClientDetailsEmail] = useState('');
  const [clientDetailsSection, setClientDetailsSection] = useState('personal');
  const [leftPanelOpen, setLeftPanelOpen] = useState(true);
  const [rightSidebarOpen, setRightSidebarOpen] = useState(false);
  const [selectedStatus, setSelectedStatus] = useState(null);
  const [showJobDetails, setShowJobDetails] = useState(false);
  const [selectedJob, setSelectedJob] = useState(null);
  const [clientSearchTerm, setClientSearchTerm] = useState('');
  const [clientStatusFilter, setClientStatusFilter] = useState('all'); // 'all', 'active', 'inactive'
  const [clientDetails, setClientDetails] = useState({});
  
  // Operations-related state
  const [showOperations, setShowOperations] = useState(isOperationsIntern);
  const [operations, setOperations] = useState([]);
  const [selectedOperation, setSelectedOperation] = useState(null);
  const [showOperationDetails, setShowOperationDetails] = useState(false);
  const [operationDetailsEmail, setOperationDetailsEmail] = useState('');
  const [operationSearchTerm, setOperationSearchTerm] = useState('');
  const [operationJobs, setOperationJobs] = useState([]);
  const [operationFilterDate, setOperationFilterDate] = useState("");
  const [selectedClientFilter, setSelectedClientFilter] = useState("");
  const [availableClients, setAvailableClients] = useState([]);
  const [operationsPerformance, setOperationsPerformance] = useState({});
  const [performanceDate, setPerformanceDate] = useState(new Date().toISOString()?.split('T')[0]);
  const [performanceEndDate, setPerformanceEndDate] = useState(new Date().toISOString()?.split('T')[0]);
  const [loadingPerformance, setLoadingPerformance] = useState(false);
  const { userRole } = useOutletContext();
  const [clientsLoaded, setClientsLoaded] = useState(false);
const [clientsPostFilter, setClientsPostFilter] = useState([]);

  // Dashboard managers state
  const [dashboardManagers, setDashboardManagers] = useState([]);
  const [loadingManagers, setLoadingManagers] = useState(false);

  // Register Client state
  const [showRegisterClient, setShowRegisterClient] = useState(false);
  const navigate = useNavigate();
  
  // Check if we're on the register client route
  useEffect(() => {
    // Check user role first - operations_intern should only see operations
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    const isOperationsIntern = user?.role === 'operations_intern';
    
    if (window.location.pathname === '/clients/new') {
      setShowRegisterClient(true);
      setShowClients(false);
      setShowOperations(false);
      setSelectedClient(null);
      setSelectedOperation(null);
      setSelectedStatus(null);
    } else if (window.location.pathname === '/manager-dashboard') {
      setShowRegisterClient(false);
      setShowClients(false);
      setShowOperations(false);
      setSelectedClient(null);
      setSelectedOperation(null);
      setSelectedStatus(null);
    } else if (window.location.pathname === '/operations' || isOperationsIntern) {
      // Show operations view for /operations route or operations_intern users
      setShowRegisterClient(false);
      setShowClients(false);
      setShowOperations(true);
      setSelectedClient(null);
      setSelectedOperation(null);
      setSelectedStatus(null);
    } else {
      setShowRegisterClient(false);
      // Default to showing clients if no specific route
      if (window.location.pathname === '/' || window.location.pathname === '/monitor-clients') {
        setShowClients(true);
        setShowOperations(false);
      }
    }
  }, []);

  // Fetch dashboard managers on component mount
  useEffect(() => {
    const fetchManagers = async () => {
      try {
        setLoadingManagers(true);
        const managers = await fetchDashboardManagers();
        setDashboardManagers(managers);
      } catch (error) {
        console.error('Error fetching dashboard managers:', error);
      } finally {
        setLoadingManagers(false);
      }
    };

    fetchManagers();
  }, []);

  // In-memory caches (TTL-based) for jobs and clients
  const cacheRef = useRef({
    clients: { data: null, ts: 0 },
    jobsByClient: {}, // { [email]: { data, ts } }
    jobDescriptions: {} // { [id]: { text, ts } }
  });
  const CACHE_TTL_MS = 60 * 1000; // 1 minute TTL
  const JD_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

  const getJobId = (job) => job?._id || job?.jobID;

  const fetchJobDescriptionById = async (id) => {
    const res = await fetch(`${API_BASE}/api/jobs/${encodeURIComponent(id)}`);
    if (!res.ok) throw new Error(`JD API ${res.status}: ${await res.text()}`);
    const data = await res.json();
    return data?.job?.jobDescription || '';
  };

  const ensureJobDescription = async (job) => {
    const id = getJobId(job);
    if (!id) return '';
    const now = Date.now();
    const entry = cacheRef.current.jobDescriptions[id];
    if (entry && now - entry.ts < JD_CACHE_TTL_MS) {
      return entry.text;
    }
    try {
      const text = await fetchJobDescriptionById(id);
      cacheRef.current.jobDescriptions[id] = { text, ts: now };
      return text;
    } catch (e) {
      console.warn('Failed to fetch job description:', e);
      return '';
    }
  };

  // (Auth removed)

  // Fetch client details
  const fetchClientDetails = async (email, bypassCache = false) => {
    try {
      const url = `${import.meta.env.VITE_BASE || 'https://applications-monitor-api.flashfirejobs.com'}/api/clients/${encodeURIComponent(email)}${bypassCache ? `?t=${Date.now()}` : ''}`;
      const response = await fetch(url, { cache: bypassCache ? 'no-store' : 'default' });
      if (response.ok) {
        const data = await response.json();
        return data.client;
      } else {
        console.error('Failed to fetch client details:', response.status);
      }
    } catch (error) {
      console.error('Error fetching client details:', error);
    }
    return null;
  };

  // Update client details in state
  const handleClientUpdate = (email, updatedClient) => {
    setClientDetails(prev => ({
      ...prev,
      [email]: updatedClient
    }));
  };

  // Operations-related functions
  const fetchOperations = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/operations`);
      if (response.ok) {
        const data = await response.json();
        setOperations(data.operations);
        // Fetch performance data for all operations
        await fetchOperationsPerformance(data.operations, performanceDate, performanceEndDate);
      }
    } catch (error) {
      console.error('Error fetching operations:', error);
    }
  };

  const fetchOperationsPerformance = async (operationsList, startDate = null, endDate = null) => {
    try {
      setLoadingPerformance(true);
      const performanceData = {};
      // Use provided dates or fallback to current state
      const dateStart = startDate !== null ? startDate : performanceDate;
      const dateEnd = endDate !== null ? endDate : performanceEndDate;
      
      // Fetch performance for each operation in parallel
      const promises = operationsList.map(async (operation) => {
        try {
          // Build query parameters for date range
          const params = new URLSearchParams();
          if (dateStart) {
            params.append('startDate', dateStart);
          }
          if (dateEnd) {
            params.append('endDate', dateEnd);
          }
          
          const response = await fetch(`${API_BASE}/api/operations/${encodeURIComponent(operation.email)}/jobs?${params.toString()}`);
          if (response.ok) {
            const data = await response.json();
            performanceData[operation.email] = data.jobs ? data.jobs.length : 0;
          } else {
            performanceData[operation.email] = 0;
          }
        } catch (error) {
          console.error(`Error fetching performance for ${operation.email}:`, error);
          performanceData[operation.email] = 0;
        }
      });
      
      await Promise.all(promises);
      setOperationsPerformance(performanceData);
    } catch (error) {
      console.error('Error fetching operations performance:', error);
    } finally {
      setLoadingPerformance(false);
    }
  };

  const fetchOperationJobs = async (operationEmail, date = null, clientFilter = null) => {
    try {
      // First, get all jobs for this operator (cache them)
      const response = await fetch(`${API_BASE}/api/operations/${encodeURIComponent(operationEmail)}/jobs`);
      if (response.ok) {
        const data = await response.json();
        let jobs = data.jobs;
        
        // Apply date filter if specified
        if (date) {
          const targetDate = new Date(date);
          const month = targetDate.getMonth() + 1;
          const day = targetDate.getDate();
          const year = targetDate.getFullYear();
          const dateString = `${day}/${month}/${year}`;
          
          jobs = jobs.filter(job => {
            return job.appliedDate && job.appliedDate.includes(dateString);
          });
        }
        
        // Filter by client if specified
        if (clientFilter) {
          jobs = jobs.filter(job => job.userID === clientFilter);
        }
        
        setOperationJobs(jobs);
      }
    } catch (error) {
      console.error('Error fetching operation jobs:', error);
    }
  };

  const fetchAvailableClients = async (operationEmail = null) => {
    try {
      // Get clients from the cached jobs instead of making a separate API call
      const response = await fetch(`${API_BASE}/api/operations/${encodeURIComponent(operationEmail)}/jobs`);
      if (response.ok) {
        const data = await response.json();
        const uniqueUserIDs = [...new Set(data.jobs.map(job => job.userID).filter(id => 
          id && /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(id)
        ))];
        setAvailableClients(uniqueUserIDs);
      }
    } catch (error) {
      console.error('Error fetching available clients:', error);
    }
  };

  const handleCloseOperationDetails = () => {
    setShowOperationDetails(false);
    setOperationDetailsEmail('');
  };

  const handleOperationSelect = (operation) => {
    setSelectedOperation(operation);
    setShowOperations(false);
    setLeftPanelOpen(false);
    fetchOperationJobs(operation.email);
    fetchAvailableClients(operation.email);
  };

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);

        const now = Date.now();

        // Single fetch — derive both email list and detail map from one request
        const FLASHFIRE_API_BASE = import.meta.env.VITE_BASE;
        const clientsResponse = await fetch(`${FLASHFIRE_API_BASE}/api/clients?t=${Date.now()}`, {
          cache: 'no-store'
        });

        if (clientsResponse.ok) {
          const clientsData = await clientsResponse.json();

          const validEmail = (s) =>
            typeof s === "string" &&
            /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/.test(s);

          const clientsArray = clientsData.clients || clientsData.data || [];
          setClientsPostFilter(clientsArray);

          const clientDetailsMap = {};
          const emailList = [];
          clientsArray.forEach(client => {
            if (validEmail(client.email)) {
              const emailLower = client.email.toLowerCase();
              clientDetailsMap[emailLower] = {
                ...client,
                status: (client.status === 'active' || client.status === 'inactive') ? client.status : 'active'
              };
              emailList.push(client.email);
            }
          });

          setClients(emailList);
          cacheRef.current.clients = { data: clientDetailsMap, ts: now };
          setClientDetails(clientDetailsMap);
          setClientsLoaded(true);
        } else {
          setErr("Failed to fetch client data");
        }

        // Fetch operations data
        await fetchOperations();
      } catch (e) {
        setErr(e.message || "Failed to fetch");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Effect to handle operation filter changes (date and client)
  useEffect(() => {
    if (selectedOperation) {
      fetchOperationJobs(selectedOperation.email, operationFilterDate, selectedClientFilter);
    }
  }, [operationFilterDate, selectedClientFilter, selectedOperation]);

  // Effect to update performance when date changes
  useEffect(() => {
    if (operations.length > 0 && performanceDate && performanceEndDate) {
      fetchOperationsPerformance(operations, performanceDate, performanceEndDate);
    }
  }, [performanceDate, performanceEndDate, operations.length]);

  // Deep-link: ?clientEmail=foo@bar.com&section=ai-summary auto-opens
  // ClientDetails on the requested section. Used by RegisterClient's
  // "Open AI Summary →" action and by the JR-direct extension's
  // "Edit in Clients-Tracking" button.
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const email = params.get('clientEmail');
      const section = params.get('section') || 'personal';
      if (email && !showClientDetails) {
        setClientDetailsEmail(email);
        setClientDetailsSection(section);
        setShowClientDetails(true);
      }
    } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Effect to fetch client details and jobs when selectedClient changes
  useEffect(() => {
    if (selectedClient) {
      // Fetch jobs for the selected client
      (async () => {
        const now = Date.now();
        const cached = cacheRef.current.jobsByClient[selectedClient];

        if (cached && now - cached.ts < CACHE_TTL_MS) {
          setJobs(cached.data);
        } else {
          try {
            // Consider a separate loading state for jobs if needed
            const data = await fetchJobsForClient(selectedClient);
            cacheRef.current.jobsByClient[selectedClient] = { data, ts: now };
            setJobs(data);
          } catch (e) {
            setErr(e.message || "Failed to fetch jobs for client");
          }
        }
      })();

      // Fetch client details (always fetch fresh data when client is selected)
      fetchClientDetails(selectedClient, true).then(client => {
        if (client) {
          setClientDetails(prev => ({
            ...prev,
            [selectedClient]: client
          }));
          const now = Date.now();
          const clientEmailLower = selectedClient.toLowerCase();
          if (cacheRef.current.clients.data) {
            cacheRef.current.clients.data[clientEmailLower] = client;
            cacheRef.current.clients.ts = now;
          }
        }
      });
    } else {
      setJobs([]); // Clear jobs when no client is selected
    }
  }, [selectedClient]);

  // Removed auto-selection - user will manually select from client cards

  const statusCounts = useMemo(() => getStatusCounts(jobs), [jobs]);

  // Applied jobs for selected client (used in both middle & right)
  const appliedJobs = useMemo(() => {
    return jobs.filter(isAppliedNow).sort(sortByUpdatedDesc);
  }, [jobs]);

  // Middle column: date-filtered applied jobs (for the selected date)
  const dateFilteredJobs = useMemo(() => {
    if (!filterDate) return [];
    const target = new Date(filterDate);
    return appliedJobs.filter((job) => {
      const dt = safeDate(job);
      return dt && sameDay(dt, target);
    });
  }, [appliedJobs, filterDate]);

  const dateAppliedCount = dateFilteredJobs.length;

  // Helper function to calculate working days (excluding Sundays)
  const calculateWorkingDays = (startDate, endDate) => {
    let workingDays = 0;
    const currentDate = new Date(startDate);
    
    while (currentDate <= endDate) {
      // Get day of week (0 = Sunday, 1 = Monday, ..., 6 = Saturday)
      const dayOfWeek = currentDate.getDay();
      
      // Count only Monday (1) to Saturday (6), exclude Sunday (0)
      if (dayOfWeek >= 1 && dayOfWeek <= 6) {
        workingDays++;
      }
      
      // Move to next day
      currentDate.setDate(currentDate.getDate() + 1);
    }
    
    return workingDays;
  };

  // Calculate daily target metrics
  const calculateDailyTarget = useMemo(() => {
    if (!selectedClient || !filterDate) return null;
    
    const clientDetail = clientDetails[selectedClient];
    if (!clientDetail || !clientDetail.applicationStartDate) return null;
    
    try {
      // Parse dates
      const startDate = new Date(clientDetail.applicationStartDate);
      const endDate = new Date(filterDate);
      
      if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) return null;
      
      // Calculate working days passed (excluding Sundays)
      const workingDaysPassed = calculateWorkingDays(startDate, endDate);
      
      if (workingDaysPassed < 0) return null; // Future date
      
      // Daily target is 35 applications per day
      const dailyTarget = 35;
      const expectedApplications = workingDaysPassed * dailyTarget;
      
      // Count actual applications in the period
      const actualApplications = jobs.filter(job => {
        if (job.userID !== selectedClient) return false;
        
        // Check if job was applied in the period
        const jobDate = safeDate(job);
        if (!jobDate) return false;
        
        return jobDate >= startDate && jobDate <= endDate && 
               isAppliedNow(job);
      }).length;
      
      return {
        daysPassed: workingDaysPassed,
        expectedApplications,
        actualApplications,
        dailyTarget
      };
    } catch (error) {
      console.error('Error calculating daily target:', error);
      return null;
    }
  }, [selectedClient, filterDate, clientDetails, jobs]);

  // Filter clients based on search term and status
  // const filteredClients = useMemo(() => {
  //   let filtered = filteredClient;
    
  //   // Filter by search term
  //   if (clientSearchTerm) {
  //     filtered = filtered.filter(client => 
  //       client.toLowerCase().includes(clientSearchTerm.toLowerCase())
  //     );
  //   }
    
  //   // Filter by status
  //   if (clientStatusFilter !== 'all') {
  //     filtered = filtered.filter(client => {
  //       const clientDetail = clientDetails[client];
  //       if (!clientDetail) return false;
        
  //       const status = clientDetail.status?.toLowerCase();
  //       return status === clientStatusFilter;
  //     });
  //   }
    
  //   return filtered;
  // }, [clients, clientSearchTerm, clientStatusFilter, clientDetails]);
const filteredClients = useMemo(() => {
  let base = Array.isArray(clientsPostFilter) ? [...clientsPostFilter] : [];

  // Search filter
  const term = clientSearchTerm.trim().toLowerCase();
  if (term) {
    base = base.filter(c =>
      c.email?.toLowerCase().includes(term) ||
      c.name?.toLowerCase().includes(term)
    );
  }

  // Status filter
  if (clientStatusFilter !== "all") {
    const want = clientStatusFilter.toLowerCase();
    base = base.filter(c =>
      (c.status?.toLowerCase() || "") === want
    );
  }

  // ✅ Safe sort
  base.sort((a, b) => {
    const aName = a?.name?.toLowerCase?.() || a?.email?.toLowerCase?.() || "";
    const bName = b?.name?.toLowerCase?.() || b?.email?.toLowerCase?.() || "";
    return aName.localeCompare(bName);
  });



  return base;
}, [clientsPostFilter, clientSearchTerm, clientStatusFilter]);
  // ✅ Compute client counts
const totalClients = Array.isArray(clientsPostFilter) ? clientsPostFilter.length : 0;
const activeClients = clientsPostFilter.filter(c => c.status?.toLowerCase() === "active").length;
const inactiveClients = clientsPostFilter.filter(c => c.status?.toLowerCase() === "inactive").length;





  // Filter operations based on search term
  const filteredOperations = useMemo(() => {
    if (!operationSearchTerm) return operations;
    return operations.filter(operation => 
      operation.name?.toLowerCase().includes(operationSearchTerm.toLowerCase()) ||
      operation.email?.toLowerCase().includes(operationSearchTerm.toLowerCase())
    );
  }, [operations, operationSearchTerm]);

  // Right sidebar: jobs filtered by selected status
  const statusFilteredJobs = useMemo(() => {
    if (!selectedStatus) return [];
    try {
      return jobs.filter((job) => {
        const current = String(job.currentStatus || "").toLowerCase();
        const last = getLastTimelineStatus(job.timeline || []);
        const status = current || last || "unknown";
        const mappedStatus = mapStatusToStandard(status);
        return mappedStatus === selectedStatus;
      }).sort(sortByUpdatedDesc);
    } catch (error) {
      console.error('Error filtering jobs by status:', error);
      return [];
    }
  }, [jobs, selectedStatus]);

  // Function to refresh client list and details
  const refreshClients = async () => {
    try {
      const FLASHFIRE_API_BASE = import.meta.env.VITE_BASE;
      const clientsResponse = await fetch(`${FLASHFIRE_API_BASE}/api/clients?t=${Date.now()}`, {
        cache: 'no-store'
      });
      
      if (clientsResponse.ok) {
        const clientsData = await clientsResponse.json();
        
        const validEmail = (s) =>
          typeof s === "string" &&
          /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/.test(s);

        const baseEmails = (clientsData?.data || [])
          .map(c => c?.email)
          .filter(validEmail);

        const clientsArray = clientsData.clients || clientsData.data || [];
        setClientsPostFilter(clientsArray);
        
        const clientDetailsMap = {};
        clientsArray.forEach(client => {
          if (validEmail(client.email)) {
            const emailLower = client.email.toLowerCase();
            clientDetailsMap[emailLower] = {
              ...client,
              status: (client.status === 'active' || client.status === 'inactive') ? client.status : 'active'
            };
          }
        });
        
        const now = Date.now();
        cacheRef.current.clients = { data: clientDetailsMap, ts: now };
        setClientDetails(prev => {
          const updated = { ...prev };
          Object.keys(clientDetailsMap).forEach(email => {
            updated[email] = clientDetailsMap[email];
          });
          return updated;
        });
        setClientsLoaded(true);
      }
    } catch (error) {
      console.error('Error refreshing clients:', error);
    }
  };

  const handleCloseClientDetails = () => {
    setShowClientDetails(false);
    setClientDetailsEmail('');
    // Refresh client list when modal closes to ensure status sync
    refreshClients();
  };

  if (showClientDetails) {
  return (
      <ClientDetails
        clientEmail={clientDetailsEmail}
        onClose={handleCloseClientDetails}
        userRole={userRole}
        onStatusUpdate={refreshClients}
        initialSection={clientDetailsSection}
      />
    );
  }

  if (showOperationDetails) {
    return (
      <OperationsDetails 
        operationEmail={operationDetailsEmail} 
        onClose={handleCloseOperationDetails}
        userRole={userRole}
      />
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-4">
      {/* Top Right Buttons (reserved) */}
      <div className="absolute top-4 right-4 z-30 flex gap-2" />

      {/* Top Bar Menu */}
      <div className="mb-4 rounded-xl border border-slate-200 bg-blue-50 shadow-sm px-3 py-2">
        <div className="flex flex-wrap gap-2 justify-center">
          {(() => {
            const navUser = JSON.parse(localStorage.getItem('user') || '{}');
            const role = navUser?.role;
            const hasAlsoCsmRole = Array.isArray(navUser?.roles) && navUser.roles.includes('csm');
            const isCsmRole = role === 'csm' || hasAlsoCsmRole;
            const isTeamLead = role === 'team_lead';

            if (role === 'operations_intern') {
              return (
                <>
                  <button
                    onClick={() => navigate('/operators-performance-report')}
                    className="px-3 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors font-medium"
                  >
                    Operators Performance Report
                  </button>
                </>
              );
            }

            if (isTeamLead || isCsmRole) {
              return (
                <>
                  <button
                    onClick={() => navigate('/client-job-analysis')}
                    className="px-3 py-2 text-sm bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition-colors font-medium"
                  >
                    Client Job Analysis
                  </button>
                  <button
                    onClick={() => navigate('/extension-jobs-report')}
                    className="px-3 py-2 text-sm bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition-colors font-medium"
                  >
                    Extension Report
                  </button>
                  <button
                    onClick={() => navigate('/operators-performance-report')}
                    className="px-3 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors font-medium"
                  >
                    Operators Performance Report
                  </button>
                  {isCsmRole ? (
                    <button
                      onClick={() => navigate('/client-onboarding')}
                      className="px-3 py-2 text-sm bg-sky-600 text-white rounded-lg hover:bg-sky-700 transition-colors font-medium"
                    >
                      Client Onboarding
                    </button>
                  ) : null}
                </>
              );
            }

            if (role === 'onboarding_team') {
              return (
                <button
                  onClick={() => navigate('/client-onboarding')}
                  className="px-3 py-2 text-sm bg-sky-600 text-white rounded-lg hover:bg-sky-700 transition-colors font-medium"
                >
                  Client Onboarding
                </button>
              );
            }

            return (
              <>
                <button
                  onClick={() => {
                    setShowClients(true);
                    setShowOperations(false);
                    setShowRegisterClient(false);
                    setSelectedClient(null);
                    setSelectedOperation(null);
                    setSelectedStatus(null);
                    setFilterDate("");
                    setOperationFilterDate("");
                    setSelectedClientFilter("");
                    setClientStatusFilter("all");
                    setRightSidebarOpen(false);
                    navigate('/');
                  }}
                  className={`px-3 py-2 text-sm rounded-lg transition-colors font-medium ${showClients ? 'bg-blue-700 text-white' : 'bg-blue-600 text-white hover:bg-blue-700'} ${navUser?.role === 'operations_intern' ? 'hidden' : ''}`}
                >
                  Clients
                </button>
                {/* <button
                  onClick={() => {
                    setShowOperations(true);
                    setShowClients(false);
                    setShowRegisterClient(false);
                    setSelectedClient(null);
                    setSelectedOperation(null);
                    setSelectedStatus(null);
                    setFilterDate("");
                    setOperationFilterDate("");
                    setSelectedClientFilter("");
                    setClientStatusFilter("all");
                    setRightSidebarOpen(false);
                    navigate('/');
                  }}
                  className={`px-3 py-2 text-sm rounded-lg transition-colors font-medium ${showOperations ? 'bg-green-700 text-white' : 'bg-green-600 text-white hover:bg-green-700'}`}
                >
                  Operations Team
                </button> */}
                <button
                  onClick={() => navigate('/client-dashboard')}
                  className={`px-3 py-2 text-sm rounded-lg transition-colors font-medium bg-purple-600 text-white hover:bg-purple-700 ${['team_lead', 'operations_intern'].includes(navUser?.role) ? 'hidden' : ''}`}
                >
                  Plan
                </button>
                <button
                  onClick={() => {
                    setShowRegisterClient(true);
                    setShowClients(false);
                    setShowOperations(false);
                    setSelectedClient(null);
                    setSelectedOperation(null);
                    setSelectedStatus(null);
                    setFilterDate("");
                    setOperationFilterDate("");
                    setSelectedClientFilter("");
                    setClientStatusFilter("all");
                    setRightSidebarOpen(false);
                    navigate('/clients/new');
                  }}
                  className={`px-3 py-2 text-sm rounded-lg transition-colors font-medium ${showRegisterClient ? 'bg-orange-700 text-white' : 'bg-orange-600 text-white hover:bg-orange-700'} ${['team_lead', 'operations_intern'].includes(navUser?.role) ? 'hidden' : ''}`}
                >
                  Register Client
                </button>
                <button
                  onClick={() => {
                    setShowRegisterClient(false);
                    setShowClients(false);
                    setShowOperations(false);
                    setSelectedClient(null);
                    setSelectedOperation(null);
                    setSelectedStatus(null);
                    setFilterDate("");
                    setOperationFilterDate("");
                    setSelectedClientFilter("");
                    setClientStatusFilter("all");
                    setRightSidebarOpen(false);
                    navigate('/manager-dashboard');
                  }}
                  className={`px-3 py-2 text-sm bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors font-medium ${['team_lead', 'operations_intern'].includes(navUser?.role) ? 'hidden' : ''}`}
                >
                  Manager Dashboard
                </button>
                {/* <button
                  onClick={() => navigate('/job-analytics')}
                  className={`px-3 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors font-medium ${navUser?.role === 'operations_intern' ? 'hidden' : ''}`}
                >
                  Job Analytics
                </button> */}
                <button
                  onClick={() => navigate('/client-job-analysis')}
                  className={`px-3 py-2 text-sm bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition-colors font-medium ${navUser?.role === 'operations_intern' ? 'hidden' : ''}`}
                >
                  Client Job Analysis
                </button>
                <button
                  onClick={() => navigate('/call-scheduler')}
                  className={`px-3 py-2 text-sm bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors font-medium ${['team_lead', 'operations_intern'].includes(navUser?.role) ? 'hidden' : ''}`}
                >
                  Call Scheduler
                </button>
                {/* <button
                  onClick={() => navigate('/client-preferences')}
                  className={`px-3 py-2 text-sm bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors font-medium ${navUser?.role === 'operations_intern' ? 'hidden' : ''}`}
                >
                  Client Preferences
                </button> */}
                <button
                  onClick={() => navigate('/client-onboarding')}
                  className="px-3 py-2 text-sm bg-sky-600 text-white rounded-lg hover:bg-sky-700 transition-colors font-medium"
                >
                  Client Onboarding
                </button>
                <button
                  onClick={() => navigate('/ai-summaries')}
                  className={`px-3 py-2 text-sm bg-fuchsia-600 text-white rounded-lg hover:bg-fuchsia-700 transition-colors font-medium ${['team_lead', 'operations_intern'].includes(navUser?.role) ? 'hidden' : ''}`}
                >
                  AI Summaries
                </button>
              </>
            );
          })()}
        </div>
      </div>

      {/* Main content area with optional right sidebar */}
      <div className="flex min-h-[calc(100vh-5rem)] rounded-xl border border-slate-200 bg-white shadow-lg relative">
      {/* Middle: Content Area */}
      <div className="flex-1 overflow-auto border-r border-slate-200 bg-slate-50">
        
        {showRegisterClient && (
          <RegisterClient />
        )}
        
        {!showRegisterClient && loading && <div className="text-slate-700 p-4">Loading…</div>}
        {!showRegisterClient && !loading && err && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center m-4">
            <div className="text-red-600 font-semibold mb-2">Error: {err}</div>
          </div>
        )}

        {!showRegisterClient && !loading && !err && showClients && (
          <div>
            <div className="mb-4">
              <h2 className="text-lg font-semibold text-slate-900 mb-4">Select a Client</h2>
            </div>
            
            
            {/* Search Bar and Status Filter */}
            <div className="mb-6 flex gap-4">
              <div className="relative flex-1">
                <input
                  type="text"
                  placeholder="Search clients..."
                  value={clientSearchTerm}
                  onChange={(e) => setClientSearchTerm(e.target.value)}
                  className="w-full px-4 py-2 pl-10 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
                <svg 
                  className="absolute left-3 top-2.5 w-5 h-5 text-slate-400" 
                  fill="none" 
                  stroke="currentColor" 
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>
              
              {/* Status Filter Dropdown */}
              <div className="flex-shrink-0">
                <select
                  value={clientStatusFilter}
                  onChange={(e) => setClientStatusFilter(e.target.value)}
                  className="px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white text-slate-700"
                >
                  <option value="all">All Status</option>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3 bg-slate-50 border border-slate-200 px-4 py-2 rounded-lg text-sm font-medium">
    <span className="text-slate-800">Total: <span className="font-bold">{totalClients}</span></span>
    <span className="text-green-600">Active: <span className="font-bold">{activeClients}</span></span>
    <span className="text-gray-500">Inactive: <span className="font-bold">{inactiveClients}</span></span>
  </div>

            {/* Client Cards Grid */}
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {filteredClients.map((client) => (
                <ClientCard 
                  key={client.email} 
                  client={client} 
                  clientDetails={clientDetails}
                  onSelect={(client) => {
                    setSelectedClient(client);
                    setShowClients(false);
                    setLeftPanelOpen(true); // Show left panel when client is selected
                  }} 
                />
              ))}
            </div>
          </div>
        )}

        {/* Operations View */}
        {!showRegisterClient && !loading && !err && showOperations && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-slate-900 mb-4">Operations Team</h2>
              <Link
                to="/operators-performance-report"
                className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors font-medium shadow-sm"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
                View Performance Report
              </Link>
            </div>
            
            {/* Search Bar */}
            <div className="mb-6">
              <div className="relative">
                <input
                  type="text"
                  placeholder="Search operations team..."
                  value={operationSearchTerm}
                  onChange={(e) => setOperationSearchTerm(e.target.value)}
                  className="w-full px-4 py-2 pl-10 border border-slate-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500"
                />
                <svg 
                  className="absolute left-3 top-2.5 w-5 h-5 text-slate-400" 
                  fill="none" 
                  stroke="currentColor" 
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>
            </div>

            {/* Operations Table */}
            <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className="px-6 py-4 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                        Team Member
                      </th>
                      <th className="px-6 py-4 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                        Email
                      </th>
                      <th className="px-6 py-4 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                        Role
                      </th>
                      <th className="px-6 py-4 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                        Clients
                      </th>
                      <th className="px-6 py-4 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                        Applied on {performanceDate === performanceEndDate ? new Date(performanceDate).toLocaleDateString('en-GB') : `${new Date(performanceDate).toLocaleDateString('en-GB')} - ${new Date(performanceEndDate).toLocaleDateString('en-GB')}`}
                      </th>
                      <th className="px-6 py-4 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                        Total Applied
                      </th>
                      <th className="px-6 py-4 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                        Total Saved
                      </th>
                      <th className="px-6 py-4 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-slate-200">
                    {filteredOperations.map((operation) => (
                      <OperationsTableRow 
                        key={operation._id} 
                        operation={operation} 
                        onSelect={handleOperationSelect}
                        performanceCount={operationsPerformance[operation.email] || 0}
                        performanceDate={performanceDate}
                        performanceEndDate={performanceEndDate}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* Operations Details View */}
        {!showRegisterClient && !loading && !err && selectedOperation && !showOperations && (
          <>
            {/* Header Section - Operations Jobs Title */}
            <div className="mb-6">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-4">
                  <button
                    onClick={() => {
                      setSelectedOperation(null);
                      setShowOperations(true);
                      setOperationJobs([]);
                      setOperationFilterDate("");
                      setSelectedClientFilter("");
                    }}
                    className="group flex items-center gap-2 px-4 py-2 bg-white border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 hover:border-slate-400 transition-all duration-200 font-medium shadow-sm"
                  >
                    <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center group-hover:bg-blue-200 transition-colors">
                      <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                      </svg>
                    </div>
                    <span>Back to Operations Team</span>
                  </button>
                </div>
                <div className="flex-1 text-center">
                  <h1 className="text-3xl font-bold text-slate-900">
                    Operations Dashboard - <span className="text-green-600">{selectedOperation.name || selectedOperation.email}</span>
                  </h1>
                  <p className="text-lg text-slate-600 mt-2">
                    Track job applications and manage client assignments
                  </p>
                </div>
                {userRole === 'admin' && (
                  <button
                    onClick={() => {
                      setShowOperationDetails(true);
                      setOperationDetailsEmail(selectedOperation.email);
                    }}
                    className="group flex items-center gap-2 px-4 py-2 bg-white border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 hover:border-slate-400 transition-all duration-200 font-medium shadow-sm"
                  >
                    <div className="w-8 h-8 bg-green-100 rounded-full flex items-center justify-center group-hover:bg-green-200 transition-colors">
                      <svg className="w-4 h-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197m13.5-9a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0z" />
                      </svg>
                    </div>
                    <span>Operator Details</span>
                    <svg className="w-4 h-4 text-slate-400 group-hover:text-slate-600 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                )}
              </div>
            </div>

            {/* Date Filter Row */}
            <div className="flex items-center gap-4 mb-6">
              <label className="text-sm font-medium text-slate-700">Filter by date:</label>
              <input
                type="date"
                value={operationFilterDate}
                onChange={(e) => setOperationFilterDate(e.target.value)}
                className="px-4 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-green-500 focus:border-green-500"
              />
              {operationFilterDate && (
                <>
                  <button
                    onClick={() => setOperationFilterDate("")}
                    className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-colors"
                  >
                    Clear
                  </button>
                  <div className="flex items-center gap-2 px-3 py-1 bg-green-50 border border-green-200 rounded-lg">
                    <span className="text-sm font-medium text-green-800">
                      Applied on {new Date(operationFilterDate).toLocaleDateString('en-GB')}:
                    </span>
                    <span className="text-sm font-bold text-green-900 bg-green-200 px-2 py-0.5 rounded">
                      {operationJobs.length}
                    </span>
                  </div>
                </>
              )}
            </div>

            {/* Client Filter Dropdown */}
            <div className="flex items-center gap-4 mb-6">
              <label className="text-sm font-medium text-slate-700">Filter by client:</label>
              <select
                value={selectedClientFilter}
                onChange={(e) => setSelectedClientFilter(e.target.value)}
                className="px-4 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-green-500 focus:border-green-500"
              >
                <option value="">All Clients</option>
                {availableClients.map((client) => (
                  <option key={client} value={client}>
                    {client}
                  </option>
                ))}
              </select>
              {selectedClientFilter && (
                <button
                  onClick={() => setSelectedClientFilter("")}
                  className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-colors"
                >
                  Clear
                </button>
              )}
            </div>

            {/* Jobs Display */}
            {operationJobs.length === 0 ? (
              <div className="text-slate-600">
                No jobs found for the selected filters.
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
                {operationJobs.map((job) => (
                  <JobCard 
                    key={job._id || job.jobID || `${job.userID}-${job.joblink}`} 
                    job={job} 
                    onJobClick={async (job) => {
                      setSelectedJob(job);
                      setShowJobDetails(true);
                      const desc = await ensureJobDescription(job);
                      setSelectedJob(prev => prev ? { ...prev, jobDescription: desc } : prev);
                    }}
                  />
                ))}
              </div>
            )}
          </>
        )}

        {!loading && !err && selectedClient && !showClients && (
          <>
            {/* Header Section - Job Applications Title */}
            <div className="mb-6">
              {/* Title and Personal Details Row */}
              <div className="flex items-center justify-between mb-6">
                <div className="flex-1 text-center">
                  <h1 className="text-3xl font-bold text-slate-900">
                    Job Applications for <span className="text-blue-600">{selectedClient}</span>
                  </h1>
                </div>
                <button
                  onClick={() => {
                    setShowClientDetails(true);
                    setClientDetailsEmail(selectedClient);
                  }}
                  className="group flex items-center gap-2 px-4 py-2 bg-white border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 hover:border-slate-400 transition-all duration-200 font-medium shadow-sm"
                >
                  <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center group-hover:bg-blue-200 transition-colors">
                    <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                    </svg>
                  </div>
                  <span>Personal Details</span>
                  <svg className="w-4 h-4 text-slate-400 group-hover:text-slate-600 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Status bar */}
            <div className="ml-8 mb-6">
            <StatusBar
              counts={statusCounts}
              dateAppliedCount={dateAppliedCount}
              filterDate={filterDate}
                onStatusClick={(status) => {
                  // Toggle functionality: if same status is clicked, close panel
                  if (selectedStatus === status && rightSidebarOpen) {
                    setRightSidebarOpen(false);
                    setSelectedStatus(null);
                  } else {
                    setSelectedStatus(status);
                    setRightSidebarOpen(true);
                  }
                }}
              />
            </div>

            {/* Client Details Section */}
            <div className="ml-8 mb-6">
              <ClientDetailsSection 
                clientEmail={selectedClient}
                clientDetails={clientDetails[selectedClient]}
                onClientUpdate={handleClientUpdate}
                dashboardManagers={dashboardManagers}
                loadingManagers={loadingManagers}
                userRole={userRole}
                onStatusUpdate={refreshClients}
              />
            </div>

            {/* Date Filter Row */}
            <div className="flex items-center gap-4">
              <label className="text-sm font-medium text-slate-700">Filter by date:</label>
              <input
                type="date"
                value={filterDate}
                onChange={(e) => setFilterDate(e.target.value)}
                className="px-4 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
              {/* Applied Today Count */}
              {filterDate && (
                <div className="flex items-center gap-2 px-3 py-1 bg-blue-50 border border-blue-200 rounded-lg">
                  <span className="text-sm font-medium text-blue-800">
                    Applied on {new Date(filterDate).toLocaleDateString('en-GB')}:
                  </span>
                  <span className="text-sm font-bold text-blue-900 bg-blue-200 px-2 py-0.5 rounded">
                    {dateAppliedCount}
                  </span>
                </div>
              )}
              {filterDate && (
                <>
                <button
                  onClick={() => setFilterDate("")}
                    className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-colors"
                >
                  Clear
                </button>
                  <div className="flex items-center gap-2 px-3 py-1 bg-blue-50 border border-blue-200 rounded-lg">
                    <span className="text-sm font-medium text-blue-800">
                      Applied on {new Date(filterDate).toLocaleDateString('en-GB')}:
                    </span>
                    <span className="text-sm font-bold text-blue-900 bg-blue-200 px-2 py-0.5 rounded">
                      {dateAppliedCount}
                    </span>
                  </div>
                  {calculateDailyTarget && (
                    <div className="flex items-center gap-2 px-3 py-1 bg-green-50 border border-green-200 rounded-lg">
                      <span className="text-sm font-medium text-green-800">
                        Expected: {calculateDailyTarget.expectedApplications} | 
                        Applied: {calculateDailyTarget.actualApplications} | 
                        Working Days: {calculateDailyTarget.daysPassed}
                      </span>
                    </div>
                  )}
                </>
              )}
            </div>

            {!filterDate && (
              <div className="text-slate-600">
                Pick a date to see jobs applied on that day.
              </div>
            )}

            {filterDate && dateFilteredJobs.length === 0 && (
              <div className="text-slate-600">
                No applied jobs for the selected date.
              </div>
            )}

            {filterDate && dateFilteredJobs.length > 0 && (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
                {dateFilteredJobs.map((job) => (
                  <JobCard 
                    key={job._id || job.jobID || `${job.userID}-${job.joblink}`} 
                    job={job} 
                    onJobClick={async (job) => {
                      setSelectedJob(job);
                      setShowJobDetails(true);
                      const desc = await ensureJobDescription(job);
                      setSelectedJob(prev => prev ? { ...prev, jobDescription: desc } : prev);
                    }}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>
      {/* Right: Jobs filtered by selected status */}
      {selectedClient && !showClients && rightSidebarOpen && (
        <div className="bg-blue-50">
          <RightAppliedColumn 
            jobs={selectedStatus ? statusFilteredJobs : appliedJobs} 
            title={selectedStatus ? selectedStatus.charAt(0).toUpperCase() + selectedStatus.slice(1) : "Applied"}
          />
        </div>
      )}
      {/* Job Details Modal */}
      <JobDetailsModal 
        job={selectedJob}
        isOpen={showJobDetails}
        onClose={() => {
          setShowJobDetails(false);
          setSelectedJob(null);
        }}
      />
      </div>
    </div>
  );
}
