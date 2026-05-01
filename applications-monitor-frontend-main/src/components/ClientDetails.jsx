import React, { useState, useEffect } from 'react';
import { hasLinkedInOptimization, planFeatureLabel } from '../utils/planFeatures';
import { parseAmount, extractCurrency, formatAmount, getCurrencyPrefix } from '../utils/currencyUtils';
import ClientAiSummary from './ClientAiSummary';

const API_BASE = import.meta.env.VITE_BASE;

const ClientDetails = ({ clientEmail, onClose, userRole = 'admin', onStatusUpdate, initialSection = 'personal' }) => {
  const [client, setClient] = useState(null);
  const [isEditing, setIsEditing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [activeSection, setActiveSection] = useState(initialSection);
  const [currency, setCurrency] = useState('$');
  const [formData, setFormData] = useState({
    name: '',
    email: clientEmail,
    jobDeadline: '',
    applicationStartDate: '',
    dashboardInternName: '',
    dashboardTeamLeadName: '',
    planType: 'ignite',
    onboardingDate: '',
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
    gmailCredentials: {
      email: '',
      password: ''
    },
    dashboardCredentials: {
      username: '',
      password: ''
    },
    linkedinCredentials: {
      username: '',
      password: ''
    },
    amountPaid: 0,
    amountPaidDate: '',
    modeOfPayment: 'paypal',
    status: 'active',
    jobStatus: 'still_searching',
    companyName: '',
    lastApplicationDate: ''
  });

  useEffect(() => {
    if (clientEmail) {
      fetchClientDetails();
    }
  }, [clientEmail]);

  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  const fetchClientDetails = async () => {
    try {
      setLoading(true);
      
      const response = await fetch(`${API_BASE}/api/clients/${encodeURIComponent(clientEmail)}?t=${Date.now()}`, {
        cache: 'no-store'
      });
      if (response.ok) {
        const data = await response.json();
        const clientData = data.client || data.updatedClientsTracking;
        setClient(clientData);
        const extractedCurrency = extractCurrency(clientData.amountPaid || '');
        setCurrency(extractedCurrency || '$');
        setFormData({
          name: clientData.name || '',
          email: clientData.email || clientEmail,
          jobDeadline: clientData.jobDeadline || '',
          applicationStartDate: clientData.applicationStartDate || '',
          dashboardInternName: clientData.dashboardInternName || '',
          dashboardTeamLeadName: clientData.dashboardTeamLeadName || '',
          planType: clientData.planType || 'ignite',
          onboardingDate: clientData.onboardingDate || '',
          whatsappGroupMade: clientData.whatsappGroupMade || false,
          whatsappGroupMadeDate: clientData.whatsappGroupMadeDate || '',
          dashboardCredentialsShared: clientData.dashboardCredentialsShared || false,
          dashboardCredentialsSharedDate: clientData.dashboardCredentialsSharedDate || '',
          resumeSent: clientData.resumeSent || false,
          resumeSentDate: clientData.resumeSentDate || '',
          coverLetterSent: clientData.coverLetterSent || false,
          coverLetterSentDate: clientData.coverLetterSentDate || '',
          portfolioMade: clientData.portfolioMade || false,
          portfolioMadeDate: clientData.portfolioMadeDate || '',
          linkedinOptimization: clientData.linkedinOptimization || false,
          linkedinOptimizationDate: clientData.linkedinOptimizationDate || '',
          gmailCredentials: {
            email: clientData.gmailCredentials?.email || '',
            password: clientData.gmailCredentials?.password || ''
          },
          dashboardCredentials: {
            username: clientData.dashboardCredentials?.username || '',
            password: clientData.dashboardCredentials?.password || ''
          },
          linkedinCredentials: {
            username: clientData.linkedinCredentials?.username || '',
            password: clientData.linkedinCredentials?.password || ''
          },
          amountPaid: parseAmount(clientData.amountPaid || 0),
          amountPaidDate: clientData.amountPaidDate || '',
          modeOfPayment: clientData.modeOfPayment || 'paypal',
          status: (clientData.status === 'active' || clientData.status === 'inactive') ? clientData.status : 'active',
          jobStatus: clientData.jobStatus || 'still_searching',
          companyName: clientData.companyName || '',
          lastApplicationDate: clientData.lastApplicationDate || ''
        });
      } else {
        setClient(null);
        setFormData(prev => ({ ...prev, email: clientEmail, status: 'active' }));
      }
    } catch (error) {
      console.error('Error fetching client details:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (e) => {
    const { name, value, type, checked } = e.target;
    if (name.startsWith('gmailCredentials.')) {
      const field = name.split('.')[1];
      setFormData(prev => ({
        ...prev,
        gmailCredentials: {
          ...prev.gmailCredentials,
          [field]: value
        }
      }));
    } else if (name.startsWith('dashboardCredentials.')) {
      const field = name.split('.')[1];
      setFormData(prev => ({
        ...prev,
        dashboardCredentials: {
          ...prev.dashboardCredentials,
          [field]: value
        }
      }));
    } else if (name.startsWith('linkedinCredentials.')) {
      const field = name.split('.')[1];
      setFormData(prev => ({
        ...prev,
        linkedinCredentials: {
          ...prev.linkedinCredentials,
          [field]: value
        }
      }));
    } else {
      setFormData(prev => ({
        ...prev,
        [name]: type === 'checkbox' ? checked : value
      }));
    }
  };

  const handleSave = async () => {
    try {
      setLoading(true);
      
      const saveData = {
        ...formData,
        amountPaid: formData.amountPaid && currency 
          ? `${currency}${formData.amountPaid}` 
          : 0,
        status: (formData.status === 'active' || formData.status === 'inactive')
          ? formData.status
          : ((client?.status === 'active' || client?.status === 'inactive') ? client.status : 'active')
      };
      
      const response = await fetch(`${API_BASE}/api/clients`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(saveData),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        setIsEditing(false);
        setLoading(false);
        console.error('Save failed - HTTP Status:', response.status, 'Response:', errorData);
        alert(`Save failed (HTTP ${response.status}): ${errorData.error || errorData.message || 'Please check console for details'}`);
        return;
      }
      
      const data = await response.json();
      const updatedClient = data?.updatedClientsTracking || data?.client;
      
      setIsEditing(false);
      
      if (updatedClient) {
        setClient(updatedClient);
      }
      
      try {
        await fetchClientDetails();
      } catch (fetchError) {
        console.error('Error refetching client details:', fetchError);
      }
      
      if (onStatusUpdate && typeof onStatusUpdate === 'function') {
        onStatusUpdate();
      }
    } catch (error) {
      console.error('Error saving client details:', error);
      setIsEditing(false);
      alert(`Network error: ${error.message}. Please check your connection and try again.`);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteUser = async () => {
    if (!window.confirm(`Are you sure you want to delete user "${clientEmail}"? This action cannot be undone and will remove all associated data.`)) {
      return;
    }

    try {
      setLoading(true);
      
      const response = await fetch(`${API_BASE}/api/clients/delete/${encodeURIComponent(clientEmail)}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (response.ok) {
        alert('User deleted successfully!');
        onClose(); // Close the modal
        // Optionally refresh the parent component
        window.location.reload();
      } else {
        const data = await response.json();
        alert(data.error || 'Failed to delete user. Please try again.');
      }
    } catch (error) {
      alert('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const planOptions = [
    { value: 'ignite', label: 'Ignite $199' },
    { value: 'professional', label: 'Professional $349' },
    { value: 'executive', label: 'Executive $599' },
    { value: 'prime', label: 'Prime $119' }
  ];

  const navigationItems = [
    {
      id: 'personal',
      label: 'Personal Information',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
        </svg>
      )
    },
    {
      id: 'gmail',
      label: 'Gmail Credentials',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 4.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
        </svg>
      )
    },
    {
      id: 'dashboard',
      label: 'Dashboard Credentials',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      )
    },
    {
      id: 'linkedin',
      label: 'LinkedIn Credentials',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
        </svg>
      )
    },
    {
      id: 'ai-summary',
      label: 'AI Summary',
      adminOnly: true,
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
        </svg>
      )
    }
  ].filter((it) => !it.adminOnly || userRole === 'admin');

  if (loading && !client) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-slate-600">Loading client details...</div>
      </div>
    );
  }

  return (
    <div 
      className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div 
        className="bg-white rounded-2xl shadow-2xl max-w-7xl w-full max-h-[95vh] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="bg-gradient-to-r from-blue-600 via-blue-700 to-indigo-700 px-8 py-6 text-white relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-r from-blue-600/20 to-indigo-700/20"></div>
          <div className="relative flex justify-between items-center">
            <div>
              <h2 className="text-3xl font-bold mb-2 flex items-center gap-3">
                <div className="p-2 bg-white/20 rounded-lg">
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                </div>
                Personal Details
              </h2>
              <p className="text-blue-100 text-lg font-medium">{clientEmail}</p>
            </div>
            <div className="flex gap-3">
              {!isEditing ? (
                userRole === 'admin' ? (
                  <>
                    <button
                      onClick={() => setIsEditing(true)}
                      className="flex items-center gap-3 px-6 py-3 bg-white text-blue-600 rounded-xl hover:bg-blue-50 transition-all duration-200 font-semibold shadow-lg hover:shadow-xl transform hover:-translate-y-0.5"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                      {client ? 'Edit Details' : 'Add Details'}
                    </button>
                    {userRole === 'admin' && (
                      <>
                        <button
                        onClick={handleDeleteUser}
                        disabled={loading}
                        className="flex items-center gap-3 px-6 py-3 bg-red-500 text-white rounded-xl hover:bg-red-600 transition-all duration-200 font-semibold shadow-lg hover:shadow-xl transform hover:-translate-y-0.5 disabled:opacity-50 disabled:transform-none"
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                        {loading ? 'Deleting...' : 'Delete User'}
                      </button>
                      </>
                    )}
                  </>
                ) : (
                  <div className="flex items-center gap-3 px-6 py-3 bg-white/20 text-white rounded-xl font-semibold shadow-lg backdrop-blur-sm">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                    View Only
                  </div>
                )
              ) : (
                <>
                  <button
                    onClick={handleSave}
                    disabled={loading}
                    className="flex items-center gap-3 px-6 py-3 bg-green-500 text-white rounded-xl hover:bg-green-600 transition-all duration-200 font-semibold shadow-lg hover:shadow-xl transform hover:-translate-y-0.5 disabled:opacity-50 disabled:transform-none"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    {loading ? 'Saving...' : 'Save Changes'}
                  </button>
                  <button
                    onClick={() => setIsEditing(false)}
                    className="flex items-center gap-3 px-6 py-3 bg-gray-500 text-white rounded-xl hover:bg-gray-600 transition-all duration-200 font-semibold shadow-lg hover:shadow-xl transform hover:-translate-y-0.5"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                    Cancel
                  </button>
                </>
              )}
              <button
                onClick={onClose}
                className="p-3 bg-white/20 text-white rounded-xl hover:bg-white/30 transition-all duration-200 backdrop-blur-sm"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="flex h-[calc(95vh-120px)] bg-gradient-to-br from-slate-50 to-blue-50">
          {/* Sidebar Navigation */}
          <div className="w-80 bg-white border-r border-slate-200 p-6 overflow-y-auto">
            <div className="space-y-2">
              {navigationItems.map((item) => {
                const linkedInDisabled = item.id === 'linkedin' && !hasLinkedInOptimization(formData.planType);
                return (
                  <button
                    key={item.id}
                    onClick={() => !linkedInDisabled && setActiveSection(item.id)}
                    title={linkedInDisabled ? planFeatureLabel('linkedin') : undefined}
                    className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left transition-all duration-200 ${
                      linkedInDisabled
                        ? 'bg-gray-100 text-gray-400 cursor-not-allowed opacity-80'
                        : activeSection === item.id
                          ? 'bg-blue-50 text-blue-700 border border-blue-200 shadow-sm'
                          : 'text-slate-600 hover:bg-slate-50 hover:text-slate-800'
                    }`}
                  >
                    <div className={`p-2 rounded-lg ${
                      linkedInDisabled ? 'bg-gray-200' : activeSection === item.id ? 'bg-blue-100' : 'bg-slate-100'
                    }`}>
                      {item.icon}
                    </div>
                    <span className="font-medium">{item.label}</span>
                    {linkedInDisabled && (
                      <span className="ml-auto text-[10px] text-gray-500">Not in plan</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Main Content Area */}
          <div className="flex-1 p-8 overflow-y-auto">
            {activeSection === 'personal' && (
              <div className="bg-white rounded-2xl p-6 shadow-lg border border-slate-200 hover:shadow-xl transition-shadow duration-300">
                <h3 className="text-lg font-semibold text-slate-900 mb-6 flex items-center gap-3">
                  <div className="p-2 bg-blue-100 rounded-lg">
                    <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                    </svg>
                  </div>
                  Personal Information
                </h3>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-2">
                      Email Address
                    </label>
                    <div className="px-4 py-3 bg-gradient-to-r from-blue-50 to-blue-100 border border-blue-200 rounded-xl text-blue-700 font-medium shadow-sm">
                      {clientEmail}
                    </div>
                  </div>
                  
                  {userRole === 'admin' && (
                    <>
                      <div>
                        <label className="block text-sm font-semibold text-slate-700 mb-2">
                          Amount Paid
                        </label>
                        {isEditing ? (
                          <div className="grid grid-cols-4 gap-2">
                            <div className="col-span-1">
                              <select
                                value={currency}
                                onChange={(e) => setCurrency(e.target.value)}
                                className="w-full px-3 py-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200 bg-white shadow-sm hover:shadow-md"
                              >
                                <option value="$">$ (USD)</option>
                                <option value="₹">₹ (INR)</option>
                                <option value="CAD">CAD</option>
                              </select>
                            </div>
                            <div className="col-span-3">
                              <input
                                type="number"
                                name="amountPaid"
                                value={formData.amountPaid}
                                onChange={handleInputChange}
                                className="w-full px-4 py-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200 bg-white shadow-sm hover:shadow-md"
                                placeholder="0.00"
                                min="0"
                                step="0.01"
                              />
                            </div>
                          </div>
                        ) : (
                          <div className="px-4 py-3 bg-gradient-to-r from-white to-slate-50 border border-slate-200 rounded-xl text-slate-700 shadow-sm">
                            {formatAmount(client?.amountPaid || 0)}
                          </div>
                        )}
                      </div>
                      
                      <div>
                        <label className="block text-sm font-semibold text-slate-700 mb-2">
                          Payment Date
                        </label>
                        {isEditing ? (
                          <input
                            type="date"
                            name="amountPaidDate"
                            value={formData.amountPaidDate}
                            onChange={handleInputChange}
                            className="w-full px-4 py-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200 bg-white shadow-sm hover:shadow-md"
                          />
                        ) : (
                          <div className="px-4 py-3 bg-gradient-to-r from-white to-slate-50 border border-slate-200 rounded-xl text-slate-700 shadow-sm">
                            {client?.amountPaidDate ? new Date(client.amountPaidDate).toLocaleDateString('en-GB') : 'Not set'}
                          </div>
                        )}
                      </div>
                      
                      <div>
                        <label className="block text-sm font-semibold text-slate-700 mb-2">
                          Mode of Payment
                        </label>
                        {isEditing ? (
                          <select
                            name="modeOfPayment"
                            value={formData.modeOfPayment}
                            onChange={handleInputChange}
                            className="w-full px-4 py-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200 bg-white shadow-sm hover:shadow-md"
                          >
                            <option value="paypal">PayPal</option>
                            <option value="wire_transfer">Wire Transfer</option>
                            <option value="inr">INR</option>
                          </select>
                        ) : (
                          <div className="px-4 py-3 bg-gradient-to-r from-white to-slate-50 border border-slate-200 rounded-xl text-slate-700 shadow-sm capitalize">
                            {client?.modeOfPayment?.replace('_', ' ') || 'Not set'}
                          </div>
                        )}
                      </div>
                      
                      <div>
                        <label className="block text-sm font-semibold text-slate-700 mb-2">
                          Client Status
                        </label>
                        {isEditing ? (
                          <select
                            name="status"
                            value={formData.status}
                            onChange={handleInputChange}
                            className="w-full px-4 py-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200 bg-white shadow-sm hover:shadow-md"
                          >
                            <option value="active">Active</option>
                            <option value="inactive">Inactive</option>
                          </select>
                        ) : (
                          <div className={`px-4 py-3 rounded-xl text-white font-semibold shadow-sm ${
                            client?.status === 'active' 
                              ? 'bg-gradient-to-r from-green-500 to-green-600' 
                              : 'bg-gradient-to-r from-gray-500 to-gray-600'
                          }`}>
                            <div className="flex items-center gap-2">
                              <div className={`w-3 h-3 rounded-full ${
                                client?.status === 'active' ? 'bg-green-200' : 'bg-gray-200'
                              }`}></div>
                              {client?.status === 'active' ? 'Active' : 'Inactive'}
                            </div>
                          </div>
                        )}
                      </div>
                    </>
                  )}
                  
                  {/* Job Status and Company Name - Visible to all users */}
                  <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-2">
                      Job Status
                    </label>
                    {isEditing ? (
                      <select
                        name="jobStatus"
                        value={formData.jobStatus}
                        onChange={handleInputChange}
                        className="w-full px-4 py-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200 bg-white shadow-sm hover:shadow-md"
                      >
                        <option value="still_searching">Still Searching</option>
                        <option value="job_done">Job Done</option>
                      </select>
                    ) : (
                      <div className={`px-4 py-3 rounded-xl text-white font-semibold shadow-sm ${
                        client?.jobStatus === 'job_done' 
                          ? 'bg-gradient-to-r from-green-500 to-green-600' 
                          : 'bg-gradient-to-r from-orange-500 to-orange-600'
                      }`}>
                        <div className="flex items-center gap-2">
                          <div className={`w-3 h-3 rounded-full ${
                            client?.jobStatus === 'job_done' ? 'bg-green-200' : 'bg-orange-200'
                          }`}></div>
                          {client?.jobStatus === 'job_done' ? 'Job Done' : 'Still Searching'}
                        </div>
                      </div>
                    )}
                  </div>
                  
                  {/* Company Name - Only enabled when Job Status is "Job Done" */}
                  <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-2">
                      Company Name
                    </label>
                    {isEditing ? (
                      <input
                        type="text"
                        name="companyName"
                        value={formData.companyName}
                        onChange={handleInputChange}
                        disabled={formData.jobStatus !== 'job_done'}
                        className={`w-full px-4 py-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200 shadow-sm hover:shadow-md ${
                          formData.jobStatus !== 'job_done' 
                            ? 'bg-gray-100 text-gray-500 cursor-not-allowed' 
                            : 'bg-white'
                        }`}
                        placeholder={formData.jobStatus !== 'job_done' ? 'Select "Job Done" to enable' : 'Enter company name'}
                      />
                    ) : (
                      <div className="px-4 py-3 bg-gradient-to-r from-white to-slate-50 border border-slate-200 rounded-xl text-slate-700 shadow-sm">
                        {client?.companyName || <span className="text-slate-400 italic">Not set</span>}
                      </div>
                    )}
                  </div>
                  
                  {/* Last Application Date */}
                  <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-2">
                      Last Application Date
                    </label>
                    {isEditing ? (
                      <input
                        type="date"
                        name="lastApplicationDate"
                        value={formData.lastApplicationDate}
                        onChange={handleInputChange}
                        className="w-full px-4 py-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200 bg-white shadow-sm hover:shadow-md"
                      />
                    ) : (
                      <div className="px-4 py-3 bg-gradient-to-r from-white to-slate-50 border border-slate-200 rounded-xl text-slate-700 shadow-sm">
                        {client?.lastApplicationDate ? new Date(client.lastApplicationDate).toLocaleDateString('en-GB') : <span className="text-slate-400 italic">Not set</span>}
                      </div>
                    )}
                      </div>
                </div>
              </div>
            )}

            {activeSection === 'gmail' && (
              <div className="bg-white rounded-2xl p-6 shadow-lg border border-slate-200 hover:shadow-xl transition-shadow duration-300">
                <h3 className="text-lg font-semibold text-slate-900 mb-4 flex items-center gap-3">
                  <div className="p-2 bg-orange-100 rounded-lg">
                    <svg className="w-5 h-5 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 4.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                    </svg>
                  </div>
                  Gmail Credentials
                </h3>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-2">Email</label>
                    {isEditing ? (
                      <input
                        type="email"
                        name="gmailCredentials.email"
                        value={formData.gmailCredentials.email}
                        onChange={handleInputChange}
                        className="w-full px-4 py-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200 bg-white shadow-sm hover:shadow-md"
                        placeholder="Gmail address"
                      />
                    ) : (
                      <div className="px-4 py-3 bg-gradient-to-r from-white to-slate-50 border border-slate-200 rounded-xl text-slate-700 shadow-sm">
                        {client?.gmailCredentials?.email || <span className="text-slate-400 italic">Not set</span>}
                      </div>
                    )}
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-2">Password</label>
                    {isEditing ? (
                      <input
                        type="password"
                        name="gmailCredentials.password"
                        value={formData.gmailCredentials.password}
                        onChange={handleInputChange}
                        className="w-full px-4 py-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200 bg-white shadow-sm hover:shadow-md"
                        placeholder="Gmail password"
                      />
                    ) : (
                      <div className="px-4 py-3 bg-gradient-to-r from-white to-slate-50 border border-slate-200 rounded-xl text-slate-700 shadow-sm">
                        {client?.gmailCredentials?.password || <span className="text-slate-400 italic">Not set</span>}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {activeSection === 'dashboard' && (
              <div className="bg-white rounded-2xl p-6 shadow-lg border border-slate-200 hover:shadow-xl transition-shadow duration-300">
                <h3 className="text-lg font-semibold text-slate-900 mb-4 flex items-center gap-3">
                  <div className="p-2 bg-blue-100 rounded-lg">
                    <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  Dashboard Credentials
                </h3>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-2">Username</label>
                    {isEditing ? (
                      <input
                        type="text"
                        name="dashboardCredentials.username"
                        value={formData.dashboardCredentials.username}
                        onChange={handleInputChange}
                        className="w-full px-4 py-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200 bg-white shadow-sm hover:shadow-md"
                        placeholder="Dashboard username"
                      />
                    ) : (
                      <div className="px-4 py-3 bg-gradient-to-r from-white to-slate-50 border border-slate-200 rounded-xl text-slate-700 shadow-sm">
                        {client?.dashboardCredentials?.username || <span className="text-slate-400 italic">Not set</span>}
                      </div>
                    )}
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-2">Password</label>
                    {isEditing ? (
                      <input
                        type="text"
                        name="dashboardCredentials.password"
                        value={formData.dashboardCredentials.password}
                        onChange={handleInputChange}
                        className="w-full px-4 py-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200 bg-white shadow-sm hover:shadow-md"
                        placeholder="Dashboard password"
                      />
                    ) : (
                      <div className="px-4 py-3 bg-gradient-to-r from-white to-slate-50 border border-slate-200 rounded-xl text-slate-700 shadow-sm">
                        {client?.dashboardCredentials?.password || <span className="text-slate-400 italic">Not set</span>}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {activeSection === 'linkedin' && (
              <div className={`rounded-2xl p-6 shadow-lg border transition-shadow duration-300 ${
                hasLinkedInOptimization(formData.planType)
                  ? 'bg-white border-slate-200 hover:shadow-xl'
                  : 'bg-gray-100 border-gray-200 opacity-90'
              }`}>
                <h3 className={`text-lg font-semibold mb-4 flex items-center gap-3 ${
                  hasLinkedInOptimization(formData.planType) ? 'text-slate-900' : 'text-gray-500'
                }`}>
                  <div className={`p-2 rounded-lg ${
                    hasLinkedInOptimization(formData.planType) ? 'bg-blue-100' : 'bg-gray-200'
                  }`}>
                    <svg className={`w-5 h-5 ${hasLinkedInOptimization(formData.planType) ? 'text-blue-700' : 'text-gray-500'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                    </svg>
                  </div>
                  LinkedIn Credentials
                  {!hasLinkedInOptimization(formData.planType) && (
                    <span className="text-sm font-normal text-gray-500" title={planFeatureLabel('linkedin')}>— Not in plan</span>
                  )}
                </h3>
                <div className="space-y-4">
                  <div>
                    <label className={`block text-sm font-semibold mb-2 ${hasLinkedInOptimization(formData.planType) ? 'text-slate-700' : 'text-gray-500'}`}>Username/Email</label>
                    {isEditing ? (
                      <input
                        type="text"
                        name="linkedinCredentials.username"
                        value={formData.linkedinCredentials.username}
                        onChange={handleInputChange}
                        disabled={!hasLinkedInOptimization(formData.planType)}
                        className={`w-full px-4 py-3 border rounded-xl transition-all duration-200 shadow-sm ${
                          hasLinkedInOptimization(formData.planType)
                            ? 'border-slate-300 bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500'
                            : 'border-gray-200 bg-gray-100 text-gray-500 cursor-not-allowed'
                        }`}
                        placeholder="LinkedIn username or email"
                      />
                    ) : (
                      <div className={`px-4 py-3 rounded-xl shadow-sm ${
                        hasLinkedInOptimization(formData.planType)
                          ? 'bg-gradient-to-r from-white to-slate-50 border border-slate-200 text-slate-700'
                          : 'bg-gray-100 border border-gray-200 text-gray-500'
                      }`}>
                        {client?.linkedinCredentials?.username || <span className="text-slate-400 italic">Not set</span>}
                      </div>
                    )}
                  </div>
                  <div>
                    <label className={`block text-sm font-semibold mb-2 ${hasLinkedInOptimization(formData.planType) ? 'text-slate-700' : 'text-gray-500'}`}>Password</label>
                    {isEditing ? (
                      <input
                        type="text"
                        name="linkedinCredentials.password"
                        value={formData.linkedinCredentials.password}
                        onChange={handleInputChange}
                        disabled={!hasLinkedInOptimization(formData.planType)}
                        className={`w-full px-4 py-3 border rounded-xl transition-all duration-200 shadow-sm ${
                          hasLinkedInOptimization(formData.planType)
                            ? 'border-slate-300 bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500'
                            : 'border-gray-200 bg-gray-100 text-gray-500 cursor-not-allowed'
                        }`}
                        placeholder="LinkedIn password"
                      />
                    ) : (
                      <div className={`px-4 py-3 rounded-xl shadow-sm ${
                        hasLinkedInOptimization(formData.planType)
                          ? 'bg-gradient-to-r from-white to-slate-50 border border-slate-200 text-slate-700'
                          : 'bg-gray-100 border border-gray-200 text-gray-500'
                      }`}>
                        {client?.linkedinCredentials?.password || <span className="text-slate-400 italic">Not set</span>}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {activeSection === 'ai-summary' && userRole === 'admin' && (
              <ClientAiSummary clientEmail={clientEmail} />
            )}

            {/* Record Information - Always visible */}
            {client && (
              <div className="mt-8 pt-6 border-t border-slate-200">
                <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-200">
                  <h4 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
                    <svg className="w-4 h-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    Record Information
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                    <div className="flex items-center gap-2">
                      <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <span className="text-slate-600">Created:</span>
                      <span className="font-medium text-slate-700">{client.createdAt}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                      <span className="text-slate-600">Last Updated:</span>
                      <span className="font-medium text-slate-700">{client.updatedAt}</span>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
export default ClientDetails;
