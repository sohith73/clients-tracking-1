// src/components/AdminLogin.jsx
import React, { useState } from "react";

const API_BASE_URL = import.meta.env.VITE_BASE;

export default function AdminLogin() {
  const [form, setForm] = useState({ email: "", password: "", otp: "" });
  const [loading, setLoading] = useState(false);
  const [sendingOtp, setSendingOtp] = useState(false);
  const [error, setError] = useState("");
  const [me, setMe] = useState(null);
  const [otpStep, setOtpStep] = useState(false);
  const [otpSent, setOtpSent] = useState(false);
  const [rememberFor30Days, setRememberFor30Days] = useState(true);

  function handleChange(e) {
    const { name, value } = e.target;
    setForm((f) => ({ ...f, [name]: value }));
    setError("");
  }

  async function handleRequestOtp(e) {
    e.preventDefault();
    setSendingOtp(true);
    setError("");
    try {
      const res = await fetch(`${API_BASE_URL}/api/auth/request-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: form.email, password: form.password }),
      });
      const data = await res.json();
      if (res.ok) {
        setOtpSent(true);
      } else {
        setError(data.error || "Failed to send OTP");
      }
    } catch (err) {
      setError("Network error");
    } finally {
      setSendingOtp(false);
    }
  }

  async function handleVerifyOtpAndLogin(e) {
    e.preventDefault();
    if (!form.otp || form.otp.length !== 4) {
      setError("Enter the 4-digit OTP");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const verifyRes = await fetch(`${API_BASE_URL}/api/auth/verify-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: form.email.toLowerCase(),
          otp: form.otp,
        }),
      });
      const verifyData = await verifyRes.json();
      if (!verifyRes.ok || !verifyData.trustToken) {
        setError(verifyData.error || "Invalid or expired OTP");
        setLoading(false);
        return;
      }
      if (rememberFor30Days) {
        localStorage.setItem(
          "adminOtpTrust",
          JSON.stringify({
            email: form.email.toLowerCase(),
            trustToken: verifyData.trustToken,
            verifiedAt: Date.now(),
          })
        );
      } else {
        localStorage.removeItem("adminOtpTrust");
      }
      const loginRes = await fetch(`${API_BASE_URL}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: form.email,
          password: form.password,
          trustToken: verifyData.trustToken,
        }),
      });
      const loginData = await loginRes.json();
      if (loginRes.ok) {
        localStorage.setItem("ff_admin_jwt", loginData.token);
        localStorage.setItem("authToken", loginData.token);
        localStorage.setItem("user", JSON.stringify(loginData.user));
        setMe(loginData.user);
        setOtpStep(false);
        setOtpSent(false);
      } else {
        setError(loginData.error || "Login failed");
      }
    } catch (err) {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const emailLower = form.email.trim().toLowerCase();
      const storedTrust = localStorage.getItem("adminOtpTrust");
      if (storedTrust) {
        try {
          const { trustToken, email } = JSON.parse(storedTrust);
          if (email === emailLower && trustToken) {
            const validRes = await fetch(`${API_BASE_URL}/api/auth/validate-otp-trust`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ email: emailLower, trustToken }),
            });
            const validData = await validRes.json();
            if (validData.valid) {
              const loginRes = await fetch(`${API_BASE_URL}/api/auth/login`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email: form.email, password: form.password, trustToken }),
              });
              const loginData = await loginRes.json();
              if (loginRes.ok) {
                localStorage.setItem("ff_admin_jwt", loginData.token);
                localStorage.setItem("authToken", loginData.token);
                localStorage.setItem("user", JSON.stringify(loginData.user));
                setMe(loginData.user);
                setLoading(false);
                return;
              }
            }
          }
        } catch (_) {}
      }

      const res = await fetch(`${API_BASE_URL}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: form.email,
          password: form.password,
        }),
      });
      const data = await res.json();

      if (res.ok) {
        localStorage.setItem("ff_admin_jwt", data.token);
        localStorage.setItem("authToken", data.token);
        localStorage.setItem("user", JSON.stringify(data.user));
        setMe(data.user);
      } else if (res.status === 400 && data.code === "SESSION_KEY_REQUIRED") {
        setOtpStep(true);
      } else {
        setError(data.error || "Login failed");
      }
    } catch (err) {
      setError(err.message || "Network error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ maxWidth: 420, margin: "40px auto", fontFamily: "system-ui" }}>
      <h2>Admin Login</h2>

      {otpStep ? (
        <div style={{ marginTop: 16 }}>
          <p style={{ marginBottom: 12, color: "#333" }}>
            Verify your identity with a one-time code sent to your email.
          </p>
          {!otpSent ? (
            <button
              type="button"
              onClick={handleRequestOtp}
              disabled={sendingOtp}
              style={{
                width: "100%",
                padding: "10px 16px",
                marginBottom: 12,
                background: "#ea580c",
                color: "white",
                border: "none",
                borderRadius: 8,
                cursor: sendingOtp ? "not-allowed" : "pointer",
              }}
            >
              {sendingOtp ? "Sending..." : "Send OTP to my email"}
            </button>
          ) : (
            <form onSubmit={handleVerifyOtpAndLogin} style={{ display: "grid", gap: 12 }}>
              <input
                name="otp"
                type="text"
                inputMode="numeric"
                maxLength={4}
                placeholder="4-digit OTP"
                value={form.otp}
                onChange={handleChange}
                required
                style={{ padding: 10, fontSize: 18, textAlign: "center", letterSpacing: 4 }}
              />
              <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 14 }}>
                <input
                  type="checkbox"
                  checked={rememberFor30Days}
                  onChange={(e) => setRememberFor30Days(e.target.checked)}
                />
                Remember for 30 days (skip OTP next time)
              </label>
              <button disabled={loading} type="submit">
                {loading ? "Verifying..." : "Verify OTP & Sign In"}
              </button>
            </form>
          )}
          <button
            type="button"
            onClick={() => { setOtpStep(false); setOtpSent(false); setForm((f) => ({ ...f, otp: "" })); setError(""); }}
            style={{ marginTop: 8, background: "none", border: "none", color: "#666", cursor: "pointer", fontSize: 14 }}
          >
            ← Back
          </button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} style={{ display: "grid", gap: 12, marginTop: 16 }}>
          <input
            name="email"
            type="email"
            placeholder="Email"
            value={form.email}
            onChange={handleChange}
            required
          />
          <input
            name="password"
            type="password"
            placeholder="Password"
            value={form.password}
            onChange={handleChange}
            required
          />
          <button disabled={loading} type="submit">
            {loading ? "Signing in..." : "Sign In"}
          </button>
        </form>
      )}

      {error ? <div style={{ color: "crimson", marginTop: 12 }}>{error}</div> : null}

      {me && (
        <div style={{ marginTop: 24, padding: 12, border: "1px solid #ddd", borderRadius: 8 }}>
          <div><b>Welcome:</b> {me.name} ({me.email})</div>
          <div><b>Role:</b> {me.role}</div>
          <div style={{ marginTop: 8 }}>
            <b>Access:</b>{" "}
            {me.role === "Director"
              ? "Full access to all modules."
              : me.role === "DepartmentHead"
              ? "Manage assigned interns and view their clients."
              : me.role === "Intern"
              ? "View only your assigned clients."
              : "Admin access."}
          </div>
        </div>
      )}
    </div>
  );
}
