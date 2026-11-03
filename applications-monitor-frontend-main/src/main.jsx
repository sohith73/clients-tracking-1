import React from 'react';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import ReactDOM from 'react-dom/client';
import './index.css';
import App, { AttendanceRoute } from './App';
import { Lazy } from './components/RouteFallback.jsx';

// Log unhandled promise rejections with clear prefix. Many "message channel closed" errors come from
// browser extensions (ad blockers, React DevTools, etc.), not from app code. Filter by [App] to see real errors.
window.addEventListener('unhandledrejection', (event) => {
  const msg = String(event.reason?.message || event.reason || '');
  const isExtensionError = /message channel closed|asynchronous response/i.test(msg);
  if (isExtensionError) {
    console.info('[App] Ignored extension error (not from app):', msg);
    event.preventDefault();
  } else {
    console.error('[App] Unhandled rejection:', msg, event.reason);
  }
});

// Lazy-load all route components — only the visited route's JS is downloaded
const Monitor = React.lazy(() => import('./components/Monitor'));
const AdminDashboard = React.lazy(() => import('./components/AdminDashboard.jsx'));
const ManagerDashboard = React.lazy(() => import('./components/ManagerDashboard.jsx'));
const ClientDashboard = React.lazy(() => import('./components/ClientDashboard.jsx'));
const JobAnalytics = React.lazy(() => import('./components/JobAnalytics.jsx'));
const ClientJobAnalysis = React.lazy(() => import('./components/ClientJobAnalysis.jsx'));
const CallScheduler = React.lazy(() => import('./components/CallScheduler.jsx'));
const ClientPreferences = React.lazy(() => import('./components/ClientPreferences.jsx'));
const OperatorsPerformanceReport = React.lazy(() => import('./components/OperatorsPerformanceReport.jsx'));
const ExtensionJobsReport = React.lazy(() => import('./components/ExtensionJobsReport.jsx'));
const ClientOnboarding = React.lazy(() => import('./components/ClientOnboarding.jsx'));
const AdminSummariesPage = React.lazy(() => import('./components/AdminSummariesPage.jsx'));
const AutoExtensionReport = React.lazy(() => import('./components/AutoExtensionReport.jsx'));


const router = createBrowserRouter([
  {
    path: '/',
    element: <App />,
    children: [
      { path: "*", element: <p>Page not found.</p> },
      { path: "/attendance", element: <AttendanceRoute page="today" /> },
      { path: "/attendance/leaves", element: <AttendanceRoute page="leaves" /> },
      { path: "/attendance/admin", element: <AttendanceRoute page="admin" admin /> },
      { path: "/attendance/admin/leaves", element: <AttendanceRoute page="approvals" admin /> },
      { path: "/attendance/admin/grid", element: <AttendanceRoute page="grid" admin /> },
      { path: "/attendance/admin/settings", element: <AttendanceRoute page="settings" admin /> },
      { element: <Lazy><Monitor /></Lazy>, index: true },
      { path: '/clients/new', element: <Lazy><Monitor /></Lazy> },
      { path: '/monitor', element: <Lazy><Monitor /></Lazy> },
      { path: '/monitor-clients', element: <Lazy><Monitor /></Lazy> },
      { path: '/admin-dashboard', element: <Lazy><AdminDashboard /></Lazy> },
      { path: '/manager-dashboard', element: <Lazy><ManagerDashboard /></Lazy> },
      { path: '/operations', element: <Lazy><Monitor /></Lazy> },
      { path: '/client-dashboard', element: <Lazy><ClientDashboard /></Lazy> },
      { path: '/job-analytics', element: <Lazy><JobAnalytics /></Lazy> },
      { path: '/client-job-analysis', element: <Lazy><ClientJobAnalysis /></Lazy> },
      { path: '/call-scheduler', element: <Lazy><CallScheduler /></Lazy> },
      { path: '/client-preferences', element: <Lazy><ClientPreferences /></Lazy> },
      { path: '/client-onboarding', element: <Lazy><ClientOnboarding /></Lazy> },
      { path: '/operators-performance-report', element: <Lazy><OperatorsPerformanceReport /></Lazy> },
      { path: '/extension-jobs-report', element: <Lazy><ExtensionJobsReport /></Lazy> },
      { path: '/ai-summaries', element: <Lazy><AdminSummariesPage /></Lazy> },
      { path: '/auto-extension', element: <Lazy><AutoExtensionReport /></Lazy> }
    ]
  }
]);

ReactDOM.createRoot(document.getElementById('root')).render(
  <RouterProvider router={router} />
);
