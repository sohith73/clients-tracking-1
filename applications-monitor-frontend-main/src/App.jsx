import React, { useState, useEffect, useRef, Suspense } from 'react';
import Login from './components/Login';
import ConnectGmailButton from './components/ConnectGmailButton.jsx';
import PortalNav from './components/PortalNav.jsx';
import { Link, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { startTokenRefresh, stopTokenRefresh } from './utils/tokenRefresh';

// Lazy so the chat bundle (framer-motion etc.) never blocks first paint
const ChatWidget = React.lazy(() => import('./components/ChatWidget/ChatWidget.jsx'));

function App() {
  const [user, setUser] = useState(() => {
    const saved = localStorage.getItem('user');
    
    return saved ? JSON.parse(saved) : null;
  });
  const [loading, setLoading] = useState(true);
  const location = useLocation();
  const navigate = useNavigate();
  const initialPath = useRef(location.pathname);
// console.log(user)
  // ✅ Check for logged-in user on mount
  useEffect(() => {
    const savedUser = localStorage.getItem('user');
    const savedToken = localStorage.getItem('authToken');

    if (savedUser && savedToken) {
      try {
        const userData = JSON.parse(savedUser);
        setUser(userData);

        // Only redirect from root path - run once on mount
        if (initialPath.current === '/') {
          if (userData.role === 'bda') {
            navigate('/attendance');
          } else if (userData.role === 'admin') {
            navigate('/admin-dashboard');
          } else if (userData.role === 'operations_intern') {
            navigate('/operators-performance-report');
          } else if (userData.role === 'onboarding_team') {
            navigate('/client-onboarding');
          } else if (userData.role === 'csm' || (userData.role === 'team_lead' && Array.isArray(userData.roles) && userData.roles.includes('csm'))) {
            navigate('/client-onboarding');
          } else if (userData.role === 'team_lead') {
            navigate('/client-job-analysis');
          } else {
            navigate('/monitor-clients');
          }
        }
      
        // Clear invalid data

      } catch {

        localStorage.removeItem('user');
        localStorage.removeItem('authToken');
      }
    }
    setLoading(false);
  }, [navigate]);

  // ✅ Redirect admin automatically once (prevents infinite loop)
  // useEffect(() => {
  //   if (user && user.role === 'admin') {
  //     // When admin logs in or page refreshes, ensure correct landing page
  //     if (location.pathname === '/' || location.pathname === '/admin-dashboard') {
  //       navigate('/monitor-clients', { replace: true });
  //     }
  //   } else if (user && user.role !== 'admin') {
  //     // Team lead default redirect
  //     if (location.pathname === '/' || location.pathname === '/admin-dashboard') {
  //       navigate('/monitor', { replace: true });
  //     }
  //   }
  // }, [user, navigate, location.pathname]);

//   useEffect(() => {
//   if (user && user.role === 'admin') {
//     // Redirect only if on the root page
//     if (location.pathname === '/') {
//       navigate('/admin-dashboard', { replace: true });
//     }
//   } else if (user && user.role == 'team_lead') {
//     if (location.pathname === '/') {
//       navigate('/monitor', { replace: true });
//     }
//   }
// }, [user, navigate, location.pathname]);

  // }, []); // Remove location.pathname and navigate from dependencies 
  // Sliding session: rotate the 30-day token daily while the user is active.
  useEffect(() => {
    if (!user) return;
    startTokenRefresh();
    return () => stopTokenRefresh();
  }, [user]);

  const handleLogin = (userData) => {
    setUser(userData);

    // Navigate based on user role
    if (userData.role === 'bda') {
      navigate('/attendance');
    } else if (userData.role === 'admin') {
      navigate('/admin-dashboard');
    } else if (userData.role === 'operations_intern') {
      navigate('/operators-performance-report');
    } else if (userData.role === 'onboarding_team') {
      navigate('/client-onboarding');
    } else if (userData.role === 'csm' || (userData.role === 'team_lead' && Array.isArray(userData.roles) && userData.roles.includes('csm'))) {
      navigate('/client-onboarding');
    } else if (userData.role === 'team_lead') {
      navigate('/client-job-analysis');
    } else {
      navigate('/monitor-clients');
    }
  };

  const handleLogout = () => {
    setUser(null);
    localStorage.removeItem('user');
    localStorage.removeItem('authToken');
    navigate('/', { replace: true });
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  if (!user) return <Login onLogin={handleLogin} />;
  if (user.role === 'bda') {
    if (!['/attendance', '/attendance/leaves'].includes(location.pathname)) return <Navigate to="/attendance" replace />;
    return (
      <>
        <header className="bg-white shadow-sm border-b">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center justify-between py-3">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-red-600 rounded-lg flex items-center justify-center text-white font-bold text-sm" aria-hidden="true">F</div>
              <div>
                <h1 className="text-lg font-semibold text-gray-900">FlashFire Attendance</h1>
                <p className="text-sm text-gray-600">{user.name || user.email}</p>
              </div>
            </div>
            <button
              onClick={handleLogout}
              className="h-10 px-4 bg-gray-600 text-white rounded-md hover:bg-gray-700 transition-colors text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-600 focus-visible:ring-offset-2"
            >
              Logout
            </button>
          </div>
        </header>
        <Outlet context={{ user, userRole: user.role }} />
      </>
    );
  }

  // ===============================
  // ✅ Admin Layout (with Navbar)
  // ===============================

  if (user.role === 'admin') {
    return (
      <div>
        {/* Admin Navigation Bar */}
        <div className="bg-white shadow-sm border-b">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center py-3">
              <div className="flex items-center gap-3">
                {/* Logo */}
                <div className="w-8 h-8 bg-red-600 rounded-lg flex items-center justify-center">
                  <svg className="w-6 h-6 text-white" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M4 2h12v4H8v4h6v4H8v8H4V2z" />
                    <path d="M16 2c2 2 4 6 2 10-1 2-3 3-5 3 2-2 3-5 1-7-1-1-2-2-1-3 1-1 2-2 3-3z" />
                    <path d="M18 6c1 1 2 3 1 5-0.5 1-1.5 1.5-2.5 1.5 1-1 1.5-2.5 0.5-3.5-0.5-0.5-1-1-0.5-1.5 0.5-0.5 1-1 1.5-1.5z" />
                  </svg>
                </div>
                <div>
                  <h1 className="text-lg font-semibold text-gray-900">Client Tracking Portal</h1>
                  <p className="text-sm text-gray-600">Admin: {user.email}</p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 sm:gap-3 justify-end">
                <Link to="/client-onboarding">
                  <button className="px-4 py-2 bg-sky-600 text-white rounded-lg hover:bg-sky-700 transition-colors text-sm">
                    Client Onboarding
                  </button>
                </Link>
                <Link to="/operators-performance-report">
                  <button className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors text-sm">
                    Performance Report
                  </button>
                </Link>
                <Link to="/extension-jobs-report">
                  <button className="px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition-colors text-sm">
                    Extension Report
                  </button>
                </Link>
                <Link to={location.pathname === "/admin-dashboard" ? "/monitor-clients" : "/admin-dashboard"}>
                  <button className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm">
                    {location.pathname === "/admin-dashboard" ? "Monitor Clients" : "Admin Dashboard"}
                  </button>
                </Link>
                <Link className="px-4 py-2 bg-blue-600 text-white rounded-lg" to={user.role === 'admin' ? '/attendance/admin' : '/attendance'}>Attendance</Link>
                <ConnectGmailButton />
                <button
                  onClick={handleLogout}
                  className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors text-sm"
                >
                  Logout
                </button>
              </div>
            </div>
          </div>
        </div>
        <PortalNav user={user} />
        <Outlet context={{ user, userRole: user?.role }} />
        <Suspense fallback={null}>
          <ChatWidget user={user} />
        </Suspense>
      </div>
    );
  }

  // ===============================
  // ✅ Team Lead / Operations Intern Layout (with Navbar)
  // ===============================
  const hasAlsoCsmRole = Array.isArray(user.roles) && user.roles.includes('csm');
  const isOperationsIntern = user.role === 'operations_intern';
  const isTeamLead = user.role === 'team_lead';
  const isCsmRole = user.role === 'csm' || hasAlsoCsmRole;
  const roleLabel =
    user.role === 'operations_intern'
      ? 'Operations Intern'
      : user.role === 'csm'
        ? 'CSM'
        : user.role === 'onboarding_team'
          ? 'Onboarding'
          : 'Team Lead';
  
  return (
    <div>
      {/* Team Lead / Operations Intern Navigation Bar */}
      <div className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-3">
            <div className="flex items-center gap-3">
              {/* Logo */}
              <div className="w-8 h-8 bg-red-600 rounded-lg flex items-center justify-center">
                <svg className="w-6 h-6 text-white" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M4 2h12v4H8v4h6v4H8v8H4V2z" />
                  <path d="M16 2c2 2 4 6 2 10-1 2-3 3-5 3 2-2 3-5 1-7-1-1-2-2-1-3 1-1 2-2 3-3z" />
                  <path d="M18 6c1 1 2 3 1 5-0.5 1-1.5 1.5-2.5 1.5 1-1 1.5-2.5 0.5-3.5-0.5-0.5-1-1-0.5-1.5 0.5-0.5 1-1 1.5-1.5z" />
                </svg>
              </div>
              <div>
                <h1 className="text-lg font-semibold text-gray-900">Client Tracking Portal</h1>
                <p className="text-sm text-gray-600">{roleLabel}: {user.email}</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {isOperationsIntern && (
                <Link to="/operators-performance-report">
                  <button className="px-3 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors text-sm">
                    Operators Performance Report
                  </button>
                </Link>
              )}
              {(isTeamLead || isCsmRole) && (
                <>
                  <Link to="/client-job-analysis">
                    <button className="px-3 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition-colors text-sm">
                      Client Job Analysis
                    </button>
                  </Link>
                  <Link to="/extension-jobs-report">
                    <button className="px-3 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition-colors text-sm">
                      Extension Report
                    </button>
                  </Link>
                  <Link to="/operators-performance-report">
                    <button className="px-3 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors text-sm">
                      Operators Performance Report
                    </button>
                  </Link>
                </>
              )}
              {isCsmRole && (
                <Link to="/client-onboarding">
                  <button className="px-3 py-2 bg-sky-600 text-white rounded-lg hover:bg-sky-700 transition-colors text-sm">
                    Client Onboarding
                  </button>
                </Link>
              )}
              {user.role === 'onboarding_team' && (
                <Link to="/client-onboarding">
                  <button className="px-3 py-2 bg-sky-600 text-white rounded-lg hover:bg-sky-700 transition-colors text-sm">
                    Client Onboarding
                  </button>
                </Link>
              )}
              <Link className="px-4 py-2 bg-blue-600 text-white rounded-lg" to={user.role === 'admin' ? '/attendance/admin' : '/attendance'}>Attendance</Link>
                <ConnectGmailButton />
              <button
                onClick={handleLogout}
                className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors text-sm"
              >
                Logout
              </button>
            </div>
          </div>
        </div>
      </div>
      <PortalNav user={user} />
      <Outlet context={{ user, userRole: user?.role }} />
      <Suspense fallback={null}>
        <ChatWidget user={user} />
      </Suspense>
    </div>
  );
}

export default App;


const attendanceComponents = {
  today: React.lazy(() => import('./components/attendance/AttendanceToday.jsx')),
  leaves: React.lazy(() => import('./components/attendance/MyLeaves.jsx')),
  admin: React.lazy(() => import('./components/attendance/AdminAttendanceDashboard.jsx')),
  approvals: React.lazy(() => import('./components/attendance/AdminLeaves.jsx')),
  grid: React.lazy(() => import('./components/attendance/AdminAttendanceGrid.jsx')),
  settings: React.lazy(() => import('./components/attendance/AdminAttendanceSettings.jsx')),
};
export function AttendanceRoute({ page, admin = false }) {
  const user = JSON.parse(localStorage.getItem('user') || '{}');
  if (admin && user.role !== 'admin') return <Navigate to="/attendance" replace />;
  const Component = attendanceComponents[page];
  return <Suspense fallback={<p>Loading attendance...</p>}><Component /></Suspense>;
}
