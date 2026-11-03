import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { handleAuthFailure } from '../utils/authUtils.js';
import { fetchDashboardManagerFullNames } from '../utils/fetchDashboardManagerCatalog.js';

const API_BASE = import.meta.env.VITE_BASE ;

// Validate required environment variables
if (!API_BASE) {
  // VITE_BASE environment variable is required
}

export default function AdminDashboard() {
  const user = JSON.parse(localStorage.getItem('user') || '{}');
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showAddUser, setShowAddUser] = useState(false);
  const [newUser, setNewUser] = useState({ email: '', password: '', role: 'team_lead', name: '', onboardingSubRole: '', roles: [], otpEmail: '' });
  const [sessionKeys, setSessionKeys] = useState({});
  const [loadingSessionKey, setLoadingSessionKey] = useState({});
  const [passwordChangeModal, setPasswordChangeModal] = useState(null);
  const [passwordForm, setPasswordForm] = useState({ newPassword: '', confirmPassword: '' });
  const [passwordError, setPasswordError] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);
  const [editUserModal, setEditUserModal] = useState(null);
  const [editUserForm, setEditUserForm] = useState({ email: '', otpEmail: '', name: '', linkedDashboardManagerName: '' });
  const [dashboardManagerNames, setDashboardManagerNames] = useState([]);
  const [editUserError, setEditUserError] = useState('');
  const [savingUser, setSavingUser] = useState(false);

  // Get auth token
  const getAuthToken = () => localStorage.getItem('authToken');

  // Fetch all users
  const fetchUsers = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/auth/users`, {
        headers: {
          'Authorization': `Bearer ${getAuthToken()}`
        }
      });

      if (response.ok) {
        const data = await response.json();
        setUsers(data.users);
      } else {
        const data = await response.json().catch(() => ({}));
        if (handleAuthFailure(response, data)) return;
        setError(data.error || 'Failed to fetch users');
      }
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  };

  // Create new user
  const createUser = async (e) => {
    e.preventDefault();
    setError('');

    try {
      const response = await fetch(`${API_BASE}/api/auth/users`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${getAuthToken()}`
        },
        body: JSON.stringify({
          ...newUser,
          otpEmail: (newUser.otpEmail || '').trim() || undefined
        })
      });

      if (response.ok) {
        setNewUser({ email: '', password: '', role: 'team_lead', name: '', onboardingSubRole: '', roles: [], otpEmail: '' });
        setShowAddUser(false);
        fetchUsers(); // Refresh users list
      } else {
        const data = await response.json().catch(() => ({}));
        if (handleAuthFailure(response, data)) return;
        setError(data.error || 'Failed to create user');
      }
    } catch {
      setError('Network error');
    }
  };

  // Generate session key for user
  const generateSessionKey = async (userEmail) => {
    setLoadingSessionKey(prev => ({ ...prev, [userEmail]: true }));

    try {
      const response = await fetch(`${API_BASE}/api/auth/session-key`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${getAuthToken()}`
        },
        body: JSON.stringify({ userEmail })
      });

      if (response.ok) {
        const data = await response.json();
        setSessionKeys(prev => ({
          ...prev,
          [userEmail]: data.sessionKey
        }));
        const days = data.validDays ?? 90;
        alert(`Session key generated. Valid for ${days} days. Share it with the user.`);
      } else {
        const data = await response.json().catch(() => ({}));
        if (handleAuthFailure(response, data)) return;
        setError(data.error || 'Failed to generate session key');
      }
    } catch {
      setError('Network error');
    } finally {
      setLoadingSessionKey(prev => ({ ...prev, [userEmail]: false }));
    }
  };

  // Delete user
  const deleteUser = async (userId, userEmail) => {
    if (!window.confirm(`Are you sure you want to delete user "${userEmail}"? This action cannot be undone.`)) {
      return;
    }

    try {
      const response = await fetch(`${API_BASE}/api/auth/users/${userId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${getAuthToken()}`
        }
      });

      if (response.ok) {
        setError('');
        fetchUsers(); // Refresh users list
      } else {
        const data = await response.json().catch(() => ({}));
        if (handleAuthFailure(response, data)) return;
        setError(data.error || 'Failed to delete user');
      }
    } catch {
      setError('Network error');
    }
  };

  // Change password for admin user
  const openPasswordChangeModal = (userId, userEmail) => {
    setPasswordChangeModal({ userId, userEmail });
    setPasswordForm({ newPassword: '', confirmPassword: '' });
    setPasswordError('');
  };

  const closePasswordChangeModal = () => {
    setPasswordChangeModal(null);
    setPasswordForm({ newPassword: '', confirmPassword: '' });
    setPasswordError('');
  };

  const handlePasswordChange = async (e) => {
    e.preventDefault();
    setPasswordError('');
    setChangingPassword(true);

    // Validate passwords
    if (!passwordForm.newPassword || passwordForm.newPassword.length < 8) {
      setPasswordError('Password must be at least 8 characters long');
      setChangingPassword(false);
      return;
    }

    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setPasswordError('Passwords do not match');
      setChangingPassword(false);
      return;
    }

    try {
      const response = await fetch(`${API_BASE}/api/auth/users/${passwordChangeModal.userId}/change-password`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${getAuthToken()}`
        },
        body: JSON.stringify({
          newPassword: passwordForm.newPassword
        })
      });

      const data = await response.json().catch(() => ({}));

      if (response.ok) {
        setError('');
        closePasswordChangeModal();
        // Show success message
        setTimeout(() => {
          alert(`Password changed successfully for ${passwordChangeModal.userEmail}`);
        }, 100);
      } else {
        if (handleAuthFailure(response, data)) return;
        setPasswordError(data.error || 'Failed to change password');
      }
    } catch {
      setPasswordError('Network error. Please try again.');
    } finally {
      setChangingPassword(false);
    }
  };

  const openEditUserModal = (u) => {
    setEditUserModal(u);
    setEditUserForm({
      email: u.email || '',
      otpEmail: u.otpEmail || '',
      name: u.name || '',
      linkedDashboardManagerName: u.linkedDashboardManagerName || '',
      discordWebhookUrl: u.discordWebhookUrl || ''
    });
    setEditUserError('');
  };

  const closeEditUserModal = () => {
    setEditUserModal(null);
    setEditUserForm({ email: '', otpEmail: '', name: '', linkedDashboardManagerName: '', discordWebhookUrl: '' });
    setEditUserError('');
  };

  const handleUpdateUser = async (e) => {
    e.preventDefault();
    if (!editUserModal) return;
    setEditUserError('');
    setSavingUser(true);
    try {
      const res = await fetch(`${API_BASE}/api/auth/users/${editUserModal._id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${getAuthToken()}`
        },
        body: JSON.stringify({
          email: editUserForm.email.trim() || undefined,
          otpEmail: editUserForm.otpEmail.trim() || '',
          name: editUserForm.name.trim() || undefined,
          linkedDashboardManagerName: editUserForm.linkedDashboardManagerName?.trim() || '',
          discordWebhookUrl: editUserForm.discordWebhookUrl?.trim() || ''
        })
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        closeEditUserModal();
        fetchUsers();
      } else {
        if (handleAuthFailure(res, data)) return;
        setEditUserError(data.error || 'Failed to update user');
      }
    } catch {
      setEditUserError('Network error');
    } finally {
      setSavingUser(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  useEffect(() => {
    fetchDashboardManagerFullNames(API_BASE, () => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getAuthToken()}`
    }))
      .then(setDashboardManagerNames)
      .catch(() => setDashboardManagerNames([]));
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      {/* Header */}
      <div className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-4">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Admin Dashboard</h1>
              <p className="text-gray-600">Welcome, {user?.email}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
            <p className="text-red-600">{error}</p>
          </div>
        )}


        {/* Add User Section */}

        <div className="bg-white rounded-lg shadow-sm border p-6 mb-8">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-semibold text-gray-900">User Management</h2>
            <button
              onClick={() => setShowAddUser(!showAddUser)}
              className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
            >
              {showAddUser ? 'Cancel' : 'Add User'}
            </button>
          </div>
          

          {showAddUser && (
            <form onSubmit={createUser} className="bg-gray-50 rounded-lg p-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Email Address
                  </label>
                  <input
                    type="email"
                    value={newUser.email}
                    onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                    required
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="teamlead@example.com"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Password
                  </label>
                  <input
                    type="password"
                    value={newUser.password}
                    onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                    required
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="Enter password"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Name
                  </label>
                  <input
                    type="text"
                    value={newUser.name}
                    onChange={(e) => setNewUser({ ...newUser, name: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="Display name"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    OTP email (optional)
                  </label>
                  <input
                    type="email"
                    value={newUser.otpEmail || ''}
                    onChange={(e) => setNewUser({ ...newUser, otpEmail: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="For OTP login; leave empty to use login email"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Role
                  </label>
                  <select
                    value={newUser.role}
                    onChange={(e) => {
                      const role = e.target.value;
                      setNewUser({
                        ...newUser,
                        role,
                        onboardingSubRole: role === 'onboarding_team' ? (newUser.onboardingSubRole || 'resume_maker') : ''
                      });
                    }}
                    required
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  >
                    <option value="team_lead">Team Lead</option>
                    <option value="operations_intern">Operations Intern</option>
                    <option value="onboarding_team">Onboarding Team</option>
                    <option value="csm">CSM</option>
                    <option value="bda">BDA (attendance only)</option>
                  </select>
                </div>
                {newUser.role === 'onboarding_team' && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Sub-role
                    </label>
                    <select
                      value={newUser.onboardingSubRole || 'resume_maker'}
                      onChange={(e) => setNewUser({ ...newUser, onboardingSubRole: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    >
                      <option value="resume_maker">Resume Maker</option>
                      <option value="linkedin_and_cover_letter_optimization">LinkedIn and Cover Letter Optimization</option>
                    </select>
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="also-csm"
                    checked={Array.isArray(newUser.roles) && newUser.roles.includes('csm')}
                    onChange={(e) => setNewUser({
                      ...newUser,
                      roles: e.target.checked ? ['csm'] : []
                    })}
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <label htmlFor="also-csm" className="text-sm text-gray-700">Also CSM</label>
                </div>
              </div>
              <div className="mt-4">
                <button
                  type="submit"
                  className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
                >
                  Create User
                </button>
              </div>
            </form>
          )}
        </div>

        {/* Users List */}
        <div className="bg-white rounded-lg shadow-sm border">
          <div className="px-6 py-4 border-b">
            <h2 className="text-lg font-semibold text-gray-900">All Users</h2>
          </div>

          {loading ? (
            <div className="p-6 text-center">
              <p className="text-gray-500">Loading users...</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Email
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Role
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Status
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Session Key
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      OTP email
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {users.map((user) => (
                    <tr key={user._id}>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {user.email}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                            user.role === 'admin'
                              ? 'bg-purple-100 text-purple-800'
                              : user.role === 'operations_intern'
                              ? 'bg-orange-100 text-orange-800'
                              : user.role === 'onboarding_team'
                              ? 'bg-sky-100 text-sky-800'
                              : user.role === 'csm'
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-blue-100 text-blue-800'
                          }`}>
                            {user.role === 'operations_intern' ? 'Operations Intern' : user.role === 'team_lead' ? 'Team Lead' : user.role === 'onboarding_team' ? 'Onboarding' : user.role === 'csm' ? 'CSM' : user.role === 'bda' ? 'BDA' : user.role}
                          </span>
                          {user.role === 'onboarding_team' && user.onboardingSubRole && (
                            <span className="inline-flex px-2 py-0.5 text-xs rounded bg-slate-100 text-slate-700">
                              {user.onboardingSubRole === 'resume_maker' ? 'Resume Maker' : user.onboardingSubRole === 'linkedin_and_cover_letter_optimization' ? 'LinkedIn & Cover Letter' : ''}
                            </span>
                          )}
                          {(user.roles || []).includes('csm') && (
                            <span className="inline-flex px-2 py-0.5 text-xs rounded bg-emerald-100 text-emerald-700">CSM</span>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                          user.isActive 
                            ? 'bg-green-100 text-green-800' 
                            : 'bg-red-100 text-red-800'
                        }`}>
                          {user.isActive ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {['bda', 'team_lead', 'operations_intern', 'onboarding_team', 'csm'].includes(user.role) ? (
                          <div className="flex items-center gap-2">
                            {sessionKeys[user.email] ? (
                              <div className="flex items-center gap-2">
                                <code className="bg-gray-100 px-2 py-1 rounded text-xs font-mono">
                                  {sessionKeys[user.email]}
                                </code>
                                <button
                                  onClick={() => navigator.clipboard.writeText(sessionKeys[user.email])}
                                  className="text-blue-600 hover:text-blue-800 text-xs"
                                >
                                  Copy
                                </button>
                              </div>
                            ) : (
                              <button
                                onClick={() => generateSessionKey(user.email)}
                                disabled={loadingSessionKey[user.email]}
                                className="px-3 py-1 bg-blue-600 text-white text-xs rounded hover:bg-blue-700 disabled:opacity-50"
                              >
                                {loadingSessionKey[user.email] ? 'Generating...' : 'Generate Key'}
                              </button>
                            )}
                          </div>
                        ) : (
                          <span className="text-gray-400 text-sm">N/A</span>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {user.otpEmail ? (
                          <span className="text-gray-700">{user.otpEmail}</span>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        <div className="flex items-center gap-2 flex-wrap">
                          <button
                            onClick={() => openEditUserModal(user)}
                            className="text-gray-600 hover:text-gray-800 text-xs"
                            title="Edit email / OTP email"
                          >
                            Edit
                          </button>
                          {user.role === 'admin' && (
                            <button
                              onClick={() => openPasswordChangeModal(user._id, user.email)}
                              className="text-indigo-600 hover:text-indigo-800 text-xs"
                              title="Change password"
                            >
                              Change Password
                            </button>
                          )}
                          {['bda', 'team_lead', 'operations_intern', 'onboarding_team', 'csm'].includes(user.role) && (
                            <button
                              onClick={() => generateSessionKey(user.email)}
                              disabled={loadingSessionKey[user.email]}
                              className="text-blue-600 hover:text-blue-800 text-xs"
                            >
                              {loadingSessionKey[user.email] ? 'Generating...' : 'New Key'}
                            </button>
                          )}
                          {['bda', 'team_lead', 'operations_intern', 'onboarding_team', 'csm'].includes(user.role) && (
                            <button
                              onClick={() => deleteUser(user._id, user.email)}
                              className="text-red-600 hover:text-red-800 text-xs ml-2"
                              title="Delete user"
                            >
                              Delete
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Password Change Modal */}
      {passwordChangeModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
            <div className="px-6 py-4 border-b border-gray-200">
              <div className="flex justify-between items-center">
                <h3 className="text-lg font-semibold text-gray-900">
                  Change Password
                </h3>
                <button
                  onClick={closePasswordChangeModal}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <p className="text-sm text-gray-600 mt-1">
                Change password for: {passwordChangeModal.userEmail}
              </p>
            </div>

            <form onSubmit={handlePasswordChange} className="px-6 py-4">
              {passwordError && (
                <div className="mb-4 bg-red-50 border border-red-200 rounded-lg p-3">
                  <p className="text-sm text-red-600">{passwordError}</p>
                </div>
              )}

              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  New Password
                </label>
                <input
                  type="password"
                  value={passwordForm.newPassword}
                  onChange={(e) => setPasswordForm({ ...passwordForm, newPassword: e.target.value })}
                  required
                  minLength={8}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                  placeholder="Enter new password (min 8 characters)"
                />
              </div>

              <div className="mb-6">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Confirm Password
                </label>
                <input
                  type="password"
                  value={passwordForm.confirmPassword}
                  onChange={(e) => setPasswordForm({ ...passwordForm, confirmPassword: e.target.value })}
                  required
                  minLength={8}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                  placeholder="Confirm new password"
                />
              </div>

              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={closePasswordChangeModal}
                  className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                  disabled={changingPassword}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={changingPassword}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {changingPassword ? 'Changing...' : 'Change Password'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit User Modal (email / OTP email) */}
      {editUserModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
            <div className="px-6 py-4 border-b border-gray-200">
              <div className="flex justify-between items-center">
                <h3 className="text-lg font-semibold text-gray-900">Edit user</h3>
                <button
                  onClick={closeEditUserModal}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <p className="text-sm text-gray-600 mt-1">Role: {editUserModal.role}</p>
            </div>

            <form onSubmit={handleUpdateUser} className="px-6 py-4">
              {editUserError && (
                <div className="mb-4 bg-red-50 border border-red-200 rounded-lg p-3">
                  <p className="text-sm text-red-600">{editUserError}</p>
                </div>
              )}

              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">Email</label>
                <input
                  type="email"
                  value={editUserForm.email}
                  onChange={(e) => setEditUserForm({ ...editUserForm, email: e.target.value })}
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                  placeholder="user@example.com"
                />
              </div>

              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">OTP email (optional)</label>
                <input
                  type="email"
                  value={editUserForm.otpEmail}
                  onChange={(e) => setEditUserForm({ ...editUserForm, otpEmail: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                  placeholder="Leave empty to use login email; e.g. user@flashfirehq.com"
                />
                <p className="text-xs text-gray-500 mt-1">OTP is sent here for login. For @flashfirehq logins we auto-add .com if not set.</p>
              </div>

              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">Name</label>
                <input
                  type="text"
                  value={editUserForm.name}
                  onChange={(e) => setEditUserForm({ ...editUserForm, name: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                  placeholder="Display name"
                />
              </div>

              <div className="mb-6">
                <label className="block text-sm font-medium text-gray-700 mb-2">Discord webhook URL (optional)</label>
                <input
                  type="url"
                  value={editUserForm.discordWebhookUrl || ''}
                  onChange={(e) => setEditUserForm({ ...editUserForm, discordWebhookUrl: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 font-mono text-sm"
                  placeholder="https://discord.com/api/webhooks/…"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Create a private Discord channel → Edit channel → Integrations → Webhooks → copy the URL.
                  When this user is tagged in a ticket comment, the tag lands there instantly and repeats every 3h until they resolve it.
                </p>
              </div>

              {['team_lead', 'csm'].includes(editUserModal?.role) && (
                <div className="mb-6">
                  <label className="block text-sm font-medium text-gray-700 mb-2">Link to Dashboard Manager</label>
                  <p className="text-xs text-gray-500 mb-1">Job cards assigned to this manager will show when this user logs in.</p>
                  <select
                    value={editUserForm.linkedDashboardManagerName || ''}
                    onChange={(e) => setEditUserForm({ ...editUserForm, linkedDashboardManagerName: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                  >
                    <option value="">— Not linked —</option>
                    {dashboardManagerNames.map((name) => (
                      <option key={name} value={name}>{name}</option>
                    ))}
                  </select>
                </div>
              )}

              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={closeEditUserModal}
                  className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                  disabled={savingUser}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingUser}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {savingUser ? 'Saving...' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
