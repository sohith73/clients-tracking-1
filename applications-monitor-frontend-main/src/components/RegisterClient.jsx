import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, Mail, Lock, User, Eye, EyeOff, CheckCircle, CreditCard, Users, ArrowLeft, Plus, KeyRound } from 'lucide-react';
import { toastUtils, toastMessages } from '../utils/toastUtils.js';

const RegisterClient = () => {
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    oldEmail: '',
    password: '',
    confirmPassword: '',
    planType: 'Free Trial',
    dashboardManager: '',
    amountPaid: '',
    currency: '$',
    clientNumber: '',
    // Max number of jobs operators can push for this client. Enforced by
    // dashboard /addjob via ProfileModel.targetJobCount. Empty = no cap.
    targetJobCount: ''
  });

  const [dashboardManagers, setDashboardManagers] = useState([]);
  const [loadingManagers, setLoadingManagers] = useState(false);
  const [clients, setClients] = useState([]);
  const [loadingClients, setLoadingClients] = useState(false);
  const [showForm, setShowForm] = useState(false);

  const [response, setResponse] = useState({});
  const [lastRegisteredEmail, setLastRegisteredEmail] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errors, setErrors] = useState({});
  const navigate = useNavigate();
  
  // Password change states
  const [showPasswordChangeModal, setShowPasswordChangeModal] = useState(false);
  const [selectedClient, setSelectedClient] = useState(null);
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [passwordChangeLoading, setPasswordChangeLoading] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmNewPassword, setShowConfirmNewPassword] = useState(false);

  const fetchLatestClientNumber = async () => {
    try {
      const API_BASE_URL = import.meta.env.VITE_BASE;
      const response = await fetch(`${API_BASE_URL}/api/clients/latest-number`);
      if (response.ok) {
        const data = await response.json();
        if (data.nextClientNumber) {
          setFormData(prev => ({ ...prev, clientNumber: String(data.nextClientNumber) }));
        }
      }
    } catch (error) {
      console.error('Error fetching latest client number:', error);
    }
  };

  // Fetch dashboard managers and clients on component mount
  useEffect(() => {
    const fetchDashboardManagers = async () => {
          const token = localStorage.getItem("authToken");

      try {
        setLoadingManagers(true);
        const API_BASE_URL = import.meta.env.VITE_BASE;
        const response = await fetch(`${API_BASE_URL}/api/managers`,{
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`, // 👈 here’s the key line
      },
    });
        
        if (response.ok) {
          const data = await response.json();
          if (data) {
            setDashboardManagers(data.managers);
          }
        }
      } catch (error) {
        console.error('Error fetching dashboard managers:', error);
      } finally {
        setLoadingManagers(false);
      }
    };

    const fetchClients = async () => {
      try {
        setLoadingClients(true);
        const API_BASE_URL = import.meta.env.VITE_BASE;
        const response = await fetch(`${API_BASE_URL}/api/clients`);
        
        if (response.ok) {
          const data = await response.json();
          if (data) {
            setClients(data.clients);
          }
        }
      } catch (error) {
        console.error('Error fetching clients:', error);
      } finally {
        setLoadingClients(false);
      }
    };

    fetchDashboardManagers();
    fetchClients();
  }, []);

  useEffect(() => {
    if (showForm) {
      fetchLatestClientNumber();
    }
  }, [showForm]);

  const planOptions = [
    { value: 'Free Trial', label: 'Free Trial', description: 'Basic features to get started' },
    { value: 'Ignite', label: 'Ignite', description: 'Perfect for job seekers starting their journey' },
    { value: 'Professional', label: 'Professional', description: 'Advanced features for serious job seekers' },
    { value: 'Executive', label: 'Executive', description: 'Premium features for executive positions' },
    { value: 'Prime', label: 'Prime', description: 'Ultimate premium features for top-tier positions' }
  ];

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));

    // Clear error when user starts typing
    if (errors[name]) {
      setErrors(prev => ({
        ...prev,
        [name]: ''
      }));
    }
  };

  const validateForm = () => {
    const newErrors = {};

    if (!formData.firstName.trim()) newErrors.firstName = 'First name is required';
    if (!formData.lastName.trim()) newErrors.lastName = 'Last name is required';
    if (!formData.email.trim()) {
      newErrors.email = 'Email is required';
    } else if (!/\S+@\S+\.\S+/.test(formData.email)) {
      newErrors.email = 'Please enter a valid email address';
    }
    if (!formData.password) {
      newErrors.password = 'Password is required';
    } else if (formData.password.length < 8) {
      newErrors.password = 'Password must be at least 8 characters long';
    }
    if (formData.password !== formData.confirmPassword) {
      newErrors.confirmPassword = 'Passwords do not match';
    }
    if (!formData.dashboardManager) {
      newErrors.dashboardManager = 'Please select a dashboard manager';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e) => {
  e.preventDefault();

  if (!validateForm()) return;

  setIsLoading(true);
  const loadingToast = toastUtils.loading("Creating your account...");

  try {
    const API_BASE_URL = import.meta.env.VITE_BASE;

    // 👇 Add only what backend requires, without modifying user inputs
    const payload = {
      ...formData,
      dashboardManagers: formData.dashboardManager,
      name: `${formData.firstName || ""} ${formData.lastName || ""}`.trim(),
      email: formData.email?.toLowerCase(),
      password: formData.password,
      planType: formData.planType,
      jobDeadline: "",
      applicationStartDate: "",
      dashboardInternName: "",
      dashboardTeamLeadName: formData.dashboardManager || "",
      onboardingDate: "",
      whatsappGroupMade: false,
      whatsappGroupMadeDate: "",
      dashboardCredentialsShared: false,
      dashboardCredentialsSharedDate: "",
      resumeSent: false,
      resumeSentDate: "",
      coverLetterSent: false,
      coverLetterSentDate: "",
      portfolioMade: false,
      portfolioMadeDate: "",
      linkedinOptimization: false,
      linkedinOptimizationDate: "",
      gmailCredentials: { email: "", password: "" },
      dashboardCredentials: { username: "", password: "" },
      linkedinCredentials: { username: "", password: "" },
      amountPaid: formData.amountPaid && formData.currency 
        ? `${formData.currency}${formData.amountPaid}` 
        : 0,
      amountPaidDate: "",
      modeOfPayment: "paypal",
      status: "active",
      clientNumber: formData.clientNumber ? parseInt(formData.clientNumber.trim(), 10) : undefined,
      currentPath: window.location.pathname, // 👈 this captures /monitor-clients or /clients/new

    };

    const res = await fetch(`${API_BASE_URL}/api/clients`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await res.json();
    setResponse(data);

    if (res.ok) {
      toastUtils.dismissToast(loadingToast);
      toastUtils.success("Client registered successfully!");
      // Remember the registered client so we can show a "Build AI Summary →"
      // CTA in the success banner below the form.
      setLastRegisteredEmail(formData.email.toLowerCase());
      
      try {
        const MICROSERVICE_URL = import.meta.env.VITE_MICROSERVICE_URL || 'http://localhost:5000';
        const microservicePayload = {
          firstName: formData.firstName,
          lastName: formData.lastName,
          email: formData.email,
          oldEmail: formData.oldEmail,
          password: formData.password,
          planType: formData.planType,
          dashboardManager: formData.dashboardManager,
          amountPaid: formData.amountPaid,
          currency: formData.currency,
          amountPaidFormatted: formData.amountPaid && formData.currency 
            ? `${formData.currency}${formData.amountPaid}` 
            : 0,
        };

        const microserviceResponse = await fetch(`${MICROSERVICE_URL}/api/microservice/paid`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(microservicePayload),
        });

        if (!microserviceResponse.ok) {
          console.error('Microservice call failed:', await microserviceResponse.text());
        }
      } catch (microserviceError) {
        console.error('Error calling microservice:', microserviceError);
        // Don't fail the main registration if microservice call fails
      }

      // Sync target-job-count cap to the dashboard backend's ProfileModel
      // so /addjob can enforce it. Best-effort — registration already
      // succeeded; this is a follow-up.
      const targetVal = formData.targetJobCount?.toString().trim();
      if (targetVal !== '' && targetVal != null) {
        try {
          const dashboardBase = import.meta.env.VITE_DASHBOARD_BASE || 'http://localhost:8086';
          const n = Number.parseInt(targetVal, 10);
          if (Number.isInteger(n) && n >= 0 && n <= 10000) {
            const r = await fetch(`${dashboardBase.replace(/\/+$/, '')}/update-target-jobs`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                email: formData.email.toLowerCase(),
                targetJobCount: n,
              }),
            });
            if (!r.ok) {
              console.warn('targetJobCount sync to dashboard failed:', r.status, await r.text().catch(() => ''));
            }
          }
        } catch (e) {
          console.warn('targetJobCount sync threw:', e?.message);
        }
      }

      setFormData({
        firstName: "",
        lastName: "",
        email: "",
        oldEmail: "",
        password: "",
        confirmPassword: "",
        planType: "Free Trial",
        dashboardManager: "",
        amountPaid: "",
        currency: "$",
        clientNumber: "",
        targetJobCount: "",
      });
      setErrors({});
      setShowForm(false);

      // refresh client list
      const clientsResponse = await fetch(`${API_BASE_URL}/api/clients`);
      if (clientsResponse.ok) {
        const clientsData = await clientsResponse.json();
        setClients(clientsData.clients || clientsData.data || []);
      }
    } else {
      toastUtils.dismissToast(loadingToast);
      toastUtils.error(data?.message || "Registration failed. Please try again.");
    }
  } catch (error) {
    console.error("Registration failed:", error);
    toastUtils.dismissToast(loadingToast);
    toastUtils.error(toastMessages.networkError);
    setResponse({ message: "Registration failed. Please try again." });
  } finally {
    setIsLoading(false);
  }
};

  const handleChangePasswordClick = (client) => {
    setSelectedClient(client);
    setShowPasswordChangeModal(true);
    setNewPassword('');
    setConfirmNewPassword('');
    setPasswordError('');
    setShowNewPassword(false);
    setShowConfirmNewPassword(false);
  };

  const handlePasswordChange = async (e) => {
    e.preventDefault();
    
    // Validation
    if (!newPassword || newPassword.length < 8) {
      setPasswordError('Password must be at least 8 characters long');
      return;
    }
    
    if (newPassword !== confirmNewPassword) {
      setPasswordError('Passwords do not match');
      return;
    }

    setPasswordChangeLoading(true);
    setPasswordError('');

    try {
      const token = localStorage.getItem("authToken");
      const API_BASE_URL = import.meta.env.VITE_BASE;

      const response = await fetch(`${API_BASE_URL}/api/clients/${encodeURIComponent(selectedClient.email)}/change-password`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ newPassword })
      });

      const data = await response.json();

      if (response.ok) {
        toastUtils.success('Password changed successfully!');
        setShowPasswordChangeModal(false);
        setNewPassword('');
        setConfirmNewPassword('');
        setSelectedClient(null);
      } else {
        setPasswordError(data?.error || 'Failed to change password');
      }
    } catch (error) {
      console.error('Password change failed:', error);
      setPasswordError('Network error. Please try again.');
    } finally {
      setPasswordChangeLoading(false);
    }
  };

  const handleClosePasswordModal = () => {
    setShowPasswordChangeModal(false);
    setNewPassword('');
    setConfirmNewPassword('');
    setPasswordError('');
    setSelectedClient(null);
    setShowNewPassword(false);
    setShowConfirmNewPassword(false);
  };


  return (
    <div className="flex-1 p-6 overflow-y-auto">
      <div className="max-w-6xl mx-auto">
        {/* Simple Header */}
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold text-gray-800 mb-4">Register Client</h1>
          <button
            onClick={() => setShowForm(true)}
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add New Client
          </button>
        </div>

        {/* Post-registration banner — quick-jump to AI Summary tab */}
        {lastRegisteredEmail && (
          <div className="mb-6 flex flex-wrap items-center justify-between gap-4 bg-gradient-to-r from-emerald-50 to-blue-50 border border-emerald-300 rounded-xl p-4 shadow-sm">
            <div>
              <p className="text-sm font-semibold text-emerald-900">
                ✓ Client registered: <span className="font-mono">{lastRegisteredEmail}</span>
              </p>
              <p className="text-xs text-emerald-700 mt-1">
                Build the AI candidate summary now so the JR-Direct extension grader can use it.
              </p>
            </div>
            <div className="flex gap-2">
              <a
                href={`/ai-summaries?clientEmail=${encodeURIComponent(lastRegisteredEmail)}`}
                className="inline-flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors font-medium"
              >
                ✨ Open AI Summary →
              </a>
              <button
                onClick={() => setLastRegisteredEmail('')}
                className="px-3 py-2 bg-white border border-slate-300 text-slate-600 rounded-lg hover:bg-slate-50 transition-colors text-sm"
              >
                Dismiss
              </button>
            </div>
          </div>
        )}

        {/* Simple Clients Grid */}
        {loadingClients ? (
          <div className="text-center py-8">
            <div className="inline-flex items-center gap-2 text-gray-500">
              <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin"></div>
              Loading clients...
            </div>
          </div>
        ) : clients.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {clients.map((client) => (
              <div key={client._id} className="bg-white rounded-lg p-4 shadow border border-gray-200">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
                    <User className="w-5 h-5 text-blue-600" />
                  </div>
                  <div className="flex-1">
                    <h3 className="font-medium text-gray-900">{client.name || 'N/A'}</h3>
                    <p className="text-sm text-gray-500">{client.email}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="inline-flex items-center gap-1 px-2 py-1 bg-blue-50 text-blue-700 rounded text-xs">
                        <CreditCard className="w-3 h-3" />
                        {client.planType || 'N/A'}
                      </span>
                      <span className="text-xs text-gray-400">
                        {client.dashboardTeamLeadName || 'Unassigned'}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="mt-3 pt-3 border-t border-gray-200">
                  <button
                    onClick={() => handleChangePasswordClick(client)}
                    className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-green-50 text-green-700 rounded-md hover:bg-green-100 transition-colors"
                  >
                    <KeyRound className="w-4 h-4" />
                    Change Password
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-12">
            <Users className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-800 mb-2">No clients yet</h3>
            <p className="text-gray-500 mb-4">Add your first client to get started</p>
            <button
              onClick={() => setShowForm(true)}
              className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              <Plus className="w-4 h-4" />
              Add First Client
            </button>
          </div>
        )}

        {/* Simple Registration Form Modal */}
        {showForm && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg max-w-md w-full shadow-lg">
              <div className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold text-gray-800">Add New Client</h2>
                  <button
                    onClick={() => {
                      setShowForm(false);
                      setFormData({ firstName: '', lastName: '', email: '', oldEmail: '', password: '', confirmPassword: '', planType: 'Free Trial', dashboardManager: '', amountPaid: '', currency: '$', clientNumber: '' });
                      setErrors({});
                    }}
                    className="text-gray-400 hover:text-gray-600"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
                  {/* First Name & Last Name */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <input
                        type="text"
                        name="firstName"
                        value={formData.firstName}
                        onChange={handleInputChange}
                        placeholder="First name"
                        className={`w-full px-3 py-2 border rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
                          errors.firstName ? 'border-red-400' : 'border-gray-300'
                        }`}
                      />
                      {errors.firstName && <p className="text-red-500 text-xs mt-1">{errors.firstName}</p>}
                    </div>
                    <div>
                      <input
                        type="text"
                        name="lastName"
                        value={formData.lastName}
                        onChange={handleInputChange}
                        placeholder="Last name"
                        className={`w-full px-3 py-2 border rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
                          errors.lastName ? 'border-red-400' : 'border-gray-300'
                        }`}
                      />
                      {errors.lastName && <p className="text-red-500 text-xs mt-1">{errors.lastName}</p>}
                    </div>
                  </div>

                  {/* Email */}
                  <div>
                    <input
                      type="email"
                      name="email"
                      value={formData.email}
                      onChange={handleInputChange}
                      placeholder="Email address"
                      className={`w-full px-3 py-2 border rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
                        errors.email ? 'border-red-400' : 'border-gray-300'
                      }`}
                    />
                    {errors.email && <p className="text-red-500 text-xs mt-1">{errors.email}</p>}
                  </div>

                  {/* Old Email */}
                  <div>
                    <input
                      type="email"
                      name="oldEmail"
                      value={formData.oldEmail}
                      onChange={handleInputChange}
                      placeholder="email used in crm"
                      className={`w-full px-3 py-2 border rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
                        errors.oldEmail ? 'border-red-400' : 'border-gray-300'
                      }`}
                    />
                    {errors.oldEmail && <p className="text-red-500 text-xs mt-1">{errors.oldEmail}</p>}
                  </div>

                  {/* Plan Type & Manager */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <select
                        name="planType"
                        value={formData.planType}
                        onChange={handleInputChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      >
                        {planOptions.map((plan) => (
                          <option key={plan.value} value={plan.value}>
                            {plan.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <select
                        name="dashboardManager"
                        value={formData.dashboardManager}
                        onChange={handleInputChange}
                        disabled={loadingManagers}
                        className={`w-full px-3 py-2 border rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
                          errors.dashboardManager ? 'border-red-400' : 'border-gray-300'
                        } ${loadingManagers ? 'bg-gray-100' : ''}`}
                      >
                        <option value="">Select Manager</option>
                        {dashboardManagers.map((manager) => (
                          <option key={manager._id} value={manager.fullName}>
                            {manager.fullName}
                          </option>
                        ))}
                      </select>
                      {errors.dashboardManager && <p className="text-red-500 text-xs mt-1">{errors.dashboardManager}</p>}
                    </div>
                  </div>

                  {/* Password & Confirm */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <input
                        type={showPassword ? 'text' : 'password'}
                        name="password"
                        value={formData.password}
                        onChange={handleInputChange}
                        placeholder="Password"
                        className={`w-full px-3 py-2 border rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
                          errors.password ? 'border-red-400' : 'border-gray-300'
                        }`}
                      />
                      {errors.password && <p className="text-red-500 text-xs mt-1">{errors.password}</p>}
                    </div>
                    <div>
                      <input
                        type={showConfirmPassword ? 'text' : 'password'}
                        name="confirmPassword"
                        value={formData.confirmPassword}
                        onChange={handleInputChange}
                        placeholder="Confirm Password"
                        className={`w-full px-3 py-2 border rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
                          errors.confirmPassword ? 'border-red-400' : 'border-gray-300'
                        }`}
                      />
                      {errors.confirmPassword && <p className="text-red-500 text-xs mt-1">{errors.confirmPassword}</p>}
                    </div>
                  </div>

                  {/* Amount Paid with Currency */}
                  <div className="grid grid-cols-3 gap-3">
                    <div className="col-span-1">
                      <select
                        name="currency"
                        value={formData.currency}
                        onChange={handleInputChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      >
                        <option value="$">$ (Dollar)</option>
                        <option value="₹">₹ (Rupee)</option>
                        <option value="CAD">CAD (Canadian Dollar)</option>
                      </select>
                    </div>
                    <div className="col-span-2">
                      <input
                        type="number"
                        name="amountPaid"
                        value={formData.amountPaid}
                        onChange={handleInputChange}
                        placeholder="Amount Paid"
                        min="0"
                        step="0.01"
                        className={`w-full px-3 py-2 border rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
                          errors.amountPaid ? 'border-red-400' : 'border-gray-300'
                        }`}
                      />
                      {errors.amountPaid && <p className="text-red-500 text-xs mt-1">{errors.amountPaid}</p>}
                    </div>
                  </div>

                  {/* Client ID */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Client ID <span className="text-gray-500 text-xs">(editable)</span>
                    </label>
                    <input
                      type="number"
                      name="clientNumber"
                      value={formData.clientNumber}
                      onChange={handleInputChange}
                      placeholder="Client ID"
                      min="5809"
                      className={`w-full px-3 py-2 border rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
                        errors.clientNumber ? 'border-red-400' : 'border-gray-300'
                      }`}
                    />
                    <p className="text-xs text-gray-500 mt-1">This number will be used for the client and onboarding ticket. Leave empty to auto-generate.</p>
                    {errors.clientNumber && <p className="text-red-500 text-xs mt-1">{errors.clientNumber}</p>}
                  </div>

                  {/* Target Job Count cap */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Max jobs to push <span className="text-gray-500 text-xs">(operator cap)</span>
                    </label>
                    <input
                      type="number"
                      name="targetJobCount"
                      value={formData.targetJobCount}
                      onChange={handleInputChange}
                      placeholder="e.g. 50  (empty = no cap)"
                      min="0"
                      max="10000"
                      step="5"
                      className="w-full px-3 py-2 border rounded-md focus:ring-2 focus:ring-amber-500 focus:border-amber-500 border-gray-300"
                    />
                    <p className="text-xs text-gray-500 mt-1">Caps the total number of jobs operators (scraper + extension) can push to this client's tracker. Once reached, /addjob refuses with TARGET_REACHED. Leave empty for no cap.</p>
                  </div>

                  {/* Submit Button */}
                  <button
                    type="submit"
                    disabled={isLoading}
                    className="w-full bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isLoading ? (
                      <>
                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                        Creating...
                      </>
                    ) : (
                      <>
                        <Plus className="w-4 h-4" />
                        Add Client
                      </>
                    )}
                  </button>
                </form>
              </div>
            </div>
          </div>
        )}

        {/* Password Change Modal */}
        {showPasswordChangeModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg max-w-md w-full shadow-lg">
              <div className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold text-gray-800">Change Password</h2>
                  <button
                    onClick={handleClosePasswordModal}
                    className="text-gray-400 hover:text-gray-600"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                {selectedClient && (
                  <div className="mb-4 p-3 bg-blue-50 rounded-lg">
                    <p className="text-sm font-medium text-gray-700">
                      <span className="font-semibold">Client:</span> {selectedClient.name}
                    </p>
                    <p className="text-xs text-gray-500 mt-1">{selectedClient.email}</p>
                  </div>
                )}

                <form onSubmit={handlePasswordChange} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      New Password
                    </label>
                    <div className="relative">
                      <input
                        type={showNewPassword ? 'text' : 'password'}
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        placeholder="Enter new password (min 8 characters)"
                        className="w-full px-3 py-2 pr-10 border border-gray-300 rounded-md focus:ring-2 focus:ring-green-500 focus:border-green-500"
                        required
                      />
                      <button
                        type="button"
                        onClick={() => setShowNewPassword(!showNewPassword)}
                        className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-500 hover:text-gray-700 focus:outline-none"
                      >
                        {showNewPassword ? (
                          <EyeOff className="w-5 h-5" />
                        ) : (
                          <Eye className="w-5 h-5" />
                        )}
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Confirm New Password
                    </label>
                    <div className="relative">
                      <input
                        type={showConfirmNewPassword ? 'text' : 'password'}
                        value={confirmNewPassword}
                        onChange={(e) => setConfirmNewPassword(e.target.value)}
                        placeholder="Confirm new password"
                        className="w-full px-3 py-2 pr-10 border border-gray-300 rounded-md focus:ring-2 focus:ring-green-500 focus:border-green-500"
                        required
                      />
                      <button
                        type="button"
                        onClick={() => setShowConfirmNewPassword(!showConfirmNewPassword)}
                        className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-500 hover:text-gray-700 focus:outline-none"
                      >
                        {showConfirmNewPassword ? (
                          <EyeOff className="w-5 h-5" />
                        ) : (
                          <Eye className="w-5 h-5" />
                        )}
                      </button>
                    </div>
                  </div>

                  {passwordError && (
                    <div className="bg-red-50 border border-red-200 rounded-md p-3">
                      <p className="text-red-600 text-sm">{passwordError}</p>
                    </div>
                  )}

                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={handleClosePasswordModal}
                      className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={passwordChangeLoading}
                      className="flex-1 px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 focus:ring-2 focus:ring-green-500 focus:ring-offset-2 transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {passwordChangeLoading ? (
                        <>
                          <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                          Changing...
                        </>
                      ) : (
                        <>
                          <KeyRound className="w-4 h-4" />
                          Change Password
                        </>
                      )}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default RegisterClient;

