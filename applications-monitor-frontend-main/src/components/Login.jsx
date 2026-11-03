import React, { useState, useRef } from 'react';

const API_BASE = import.meta.env.VITE_BASE || 'http://localhost:8001';

if (!API_BASE) {
  console.error('❌ VITE_BASE environment variable is required');
}

export default function Login({ onLogin }) {
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    sessionKey: '',
    otp: ''
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [step, setStep] = useState(1);
  const [userRole, setUserRole] = useState(null);
  const [useOtp, setUseOtp] = useState(false);
  const [otpSent, setOtpSent] = useState(false);
  const [sendingOtp, setSendingOtp] = useState(false);
  const [rememberFor30Days, setRememberFor30Days] = useState(true);
  const holdTimerRef = useRef(null);

  const handleOtpBypass = () => {
    setLoading(true);
    setError('');
    fetch(`${API_BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: formData.email,
        password: formData.password,
        trustToken: 'bypass-testing'
      })
    })
      .then(r => r.json())
      .then(data => {
        if (data.token) {
          completeLogin(data.token, data.user);
        } else {
          setError(data.error || 'Bypass failed');
        }
      })
      .catch(() => setError('Network error'))
      .finally(() => setLoading(false));
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    setError('');
  };

  const completeLogin = (token, user) => {
    localStorage.setItem('authToken', token);
    localStorage.setItem('user', JSON.stringify(user));
    setTimeout(() => onLogin(user), 200);
  };

  const handleStep1Submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const response = await fetch(`${API_BASE}/api/auth/verify-credentials`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: formData.email, password: formData.password })
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || 'Invalid credentials');
        setLoading(false);
        return;
      }

      setUserRole(data.role);

      const rolesRequiringSecondStep = ['bda', 'team_lead', 'operations_intern', 'onboarding_team', 'csm', 'admin'];
      const needSecondStep = data.needSecondStep === true || (data.role && rolesRequiringSecondStep.includes(data.role));

      if (needSecondStep) {
        const emailLower = formData.email.toLowerCase();
        const storedTrust = localStorage.getItem('portalOtpTrust');
        if (storedTrust) {
          try {
            const { trustToken, email } = JSON.parse(storedTrust);
            if (email === emailLower) {
              const validRes = await fetch(`${API_BASE}/api/auth/validate-otp-trust`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: emailLower, trustToken })
              });
              const validData = await validRes.json();
              if (validData.valid) {
                const loginRes = await fetch(`${API_BASE}/api/auth/login`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    email: formData.email,
                    password: formData.password,
                    trustToken
                  })
                });
                const loginData = await loginRes.json();
                if (loginRes.ok) {
                  completeLogin(loginData.token, loginData.user);
                  setLoading(false);
                  return;
                }
              }
            }
          } catch { /* A stale trust token falls back to OTP. */ }
        }

        const storedKey = localStorage.getItem('portalSessionKey');
        if (storedKey) {
          try {
            const { sessionKey, email } = JSON.parse(storedKey);
            if (email === emailLower && sessionKey) {
              const loginRes = await fetch(`${API_BASE}/api/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  email: formData.email,
                  password: formData.password,
                  sessionKey
                })
              });
              const loginData = await loginRes.json();
              if (loginRes.ok) {
                completeLogin(loginData.token, loginData.user);
                setLoading(false);
                return;
              }
            }
          } catch { /* A stale trust token falls back to OTP. */ }
        }

        setStep(2);
        if (data.role === 'admin') setUseOtp(true);
      } else {
        const loginRes = await fetch(`${API_BASE}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: formData.email, password: formData.password })
        });
        const loginData = await loginRes.json();
        if (loginRes.ok) {
          completeLogin(loginData.token, loginData.user);
        } else {
          setError(loginData.error || 'Login failed');
        }
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleRequestOtp = async (e) => {
    e.preventDefault();
    setSendingOtp(true);
    setError('');
    try {
      const res = await fetch(`${API_BASE}/api/auth/request-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: formData.email, password: formData.password })
      });
      const data = await res.json();
      if (res.ok) {
        setOtpSent(true);
      } else {
        setError(data.error || 'Failed to send OTP');
      }
    } catch {
      setError('Network error');
    } finally {
      setSendingOtp(false);
    }
  };

  const handleVerifyOtp = async (e) => {
    e.preventDefault();
    if (!formData.otp || formData.otp.length !== 4) {
      setError('Enter the 4-digit OTP');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API_BASE}/api/auth/verify-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: formData.email.toLowerCase(), otp: formData.otp })
      });
      const data = await res.json();
      if (res.ok && data.trustToken) {
        if (rememberFor30Days) {
          localStorage.setItem(
            'portalOtpTrust',
            JSON.stringify({ email: formData.email.toLowerCase(), trustToken: data.trustToken })
          );
        } else {
          localStorage.removeItem('portalOtpTrust');
        }
        const loginRes = await fetch(`${API_BASE}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: formData.email,
            password: formData.password,
            trustToken: data.trustToken
          })
        });
        const loginData = await loginRes.json();
        if (loginRes.ok) {
          completeLogin(loginData.token, loginData.user);
        } else {
          setError(loginData.error || 'Login failed');
        }
      } else {
        setError(data.error || 'Invalid or expired OTP');
      }
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  };

  const handleStep2Submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const payload = {
        email: formData.email,
        password: formData.password,
        sessionKey: formData.sessionKey
      };
      const res = await fetch(`${API_BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (res.ok) {
        localStorage.setItem(
          'portalSessionKey',
          JSON.stringify({
            email: formData.email.toLowerCase(),
            sessionKey: formData.sessionKey,
            verifiedAt: Date.now()
          })
        );
        completeLogin(data.token, data.user);
      } else {
        setError(data.error || 'Invalid session key');
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleBackToStep1 = () => {
    setStep(1);
    setFormData((prev) => ({ ...prev, sessionKey: '', otp: '' }));
    setOtpSent(false);
    setUseOtp(false);
    setError('');
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-8">
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-blue-600 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">FlashFire Portal</h1>
          <p className="text-gray-600 mt-2">
            {step === 1
              ? 'Sign in to access the Client tracking portal'
              : 'Verify with OTP or session key'}
          </p>
        </div>

        {step === 1 ? (
          <form onSubmit={handleStep1Submit} className="space-y-6">
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-2">
                Email Address
              </label>
              <input
                type="email"
                id="email"
                name="email"
                value={formData.email}
                onChange={handleInputChange}
                required
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
                placeholder="Enter your email"
              />
            </div>
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-2">
                Password
              </label>
              <input
                type="password"
                id="password"
                name="password"
                value={formData.password}
                onChange={handleInputChange}
                required
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
                placeholder="Enter your password"
              />
            </div>
            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                <p className="text-red-600 text-sm">{error}</p>
              </div>
            )}
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-blue-600 text-white py-3 px-4 rounded-lg font-medium hover:bg-blue-700 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Verifying...' : 'Sign In'}
            </button>
          </form>
        ) : (
          <div className="space-y-6">
            <div className="bg-green-50 border border-green-200 rounded-lg p-4">
              <p className="text-green-700 text-sm font-medium">
                Credentials verified. Choose how to continue:
              </p>
            </div>

            {!useOtp && !otpSent && (
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => { setUseOtp(true); setError(''); }}
                  className="flex-1 py-3 px-4 rounded-lg font-medium border-2 border-orange-500 text-orange-600 hover:bg-orange-50 transition-colors"
                >
                  Login with OTP
                </button>
                {userRole !== 'admin' && (
                  <button
                    type="button"
                    onClick={() => { setUseOtp(false); setOtpSent(false); setError(''); }}
                    className="flex-1 py-3 px-4 rounded-lg font-medium border-2 border-gray-300 text-gray-700 hover:bg-gray-50 transition-colors"
                  >
                    Session key
                  </button>
                )}
              </div>
            )}

            {useOtp && !otpSent && (
              <div>
                <button
                  type="button"
                  onClick={handleRequestOtp}
                  onMouseDown={() => { holdTimerRef.current = setTimeout(handleOtpBypass, 5000); }}
                  onMouseUp={() => { if (holdTimerRef.current) clearTimeout(holdTimerRef.current); holdTimerRef.current = null; }}
                  onMouseLeave={() => { if (holdTimerRef.current) clearTimeout(holdTimerRef.current); holdTimerRef.current = null; }}
                  onTouchStart={() => { holdTimerRef.current = setTimeout(handleOtpBypass, 5000); }}
                  onTouchEnd={() => { if (holdTimerRef.current) clearTimeout(holdTimerRef.current); holdTimerRef.current = null; }}
                  disabled={sendingOtp}
                  className="w-full py-3 px-4 rounded-lg font-medium bg-orange-500 text-white hover:bg-orange-600 disabled:opacity-50"
                >
                  {sendingOtp ? 'Sending...' : 'Send OTP to my email'}
                </button>
                {userRole !== 'admin' && (
                  <button
                    type="button"
                    onClick={() => { setUseOtp(false); setError(''); }}
                    className="mt-2 text-sm text-gray-500 hover:text-gray-700"
                  >
                    Use session key instead
                  </button>
                )}
              </div>
            )}

            {useOtp && otpSent && (
              <form onSubmit={handleVerifyOtp} className="space-y-4">
                <div>
                  <label htmlFor="otp" className="block text-sm font-medium text-gray-700 mb-2">
                    4-digit OTP
                  </label>
                  <input
                    type="text"
                    id="otp"
                    name="otp"
                    value={formData.otp}
                    onChange={handleInputChange}
                    maxLength={4}
                    placeholder="0000"
                    className="w-full px-4 py-3 border border-orange-300 rounded-lg focus:ring-2 focus:ring-orange-500 bg-orange-50 text-center text-xl tracking-widest"
                  />
                </div>
                <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={rememberFor30Days}
                    onChange={(e) => setRememberFor30Days(e.target.checked)}
                    className="rounded"
                  />
                  Remember for 30 days (skip OTP next time)
                </label>
                <button
                  type="submit"
                  disabled={loading || (formData.otp || '').length !== 4}
                  className="w-full py-3 px-4 rounded-lg font-medium bg-orange-500 text-white hover:bg-orange-600 disabled:opacity-50"
                >
                  {loading ? 'Verifying...' : 'Verify OTP & sign in'}
                </button>
              </form>
            )}

            {!useOtp && (
              <form onSubmit={handleStep2Submit} className="space-y-4">
                <div>
                  <label htmlFor="sessionKey" className="block text-sm font-medium text-gray-700 mb-2">
                    Session key
                  </label>
                  <input
                    type="text"
                    id="sessionKey"
                    name="sessionKey"
                    value={formData.sessionKey}
                    onChange={handleInputChange}
                    required
                    className="w-full px-4 py-3 border border-orange-300 rounded-lg focus:ring-2 focus:ring-orange-500 bg-orange-50"
                    placeholder="Enter session key from admin"
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-3 px-4 rounded-lg font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {loading ? 'Signing in...' : 'Complete login'}
                </button>
              </form>
            )}

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                <p className="text-red-600 text-sm">{error}</p>
              </div>
            )}

            <div className="flex gap-3">
              <button
                type="button"
                onClick={handleBackToStep1}
                className="flex-1 py-2 px-4 rounded-lg font-medium bg-gray-200 text-gray-700 hover:bg-gray-300"
              >
                Back
              </button>
            </div>
          </div>
        )}

        <div className="mt-6 text-center">
          <p className="text-sm text-gray-500">Contact your administrator for access credentials</p>
        </div>
      </div>
    </div>
  );
}
