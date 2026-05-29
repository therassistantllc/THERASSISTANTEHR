"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    setLoading(false);
    if (error) {
      setError(error.message);
    } else {
      router.push("/");
    }
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);

    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName || null,
        },
      },
    });
    setLoading(false);

    if (error) {
      setError(error.message);
      return;
    }

    const hasSession = Boolean(data.session);
    if (hasSession) {
      router.push("/");
      return;
    }

    setMessage("Account created. Check your email to confirm your account before signing in.");
    setMode("login");
    setPassword("");
    setConfirmPassword("");
  }

  function switchMode(next: "login" | "register") {
    setMode(next);
    setError(null);
    setMessage(null);
    setPassword("");
    setConfirmPassword("");
  }

  return (
    <div style={{
      minHeight: "100vh",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: "var(--navy, #10243f)",
    }}>
      <div style={{
        background: "#fff",
        borderRadius: "12px",
        padding: "48px 40px",
        width: "100%",
        maxWidth: "400px",
        boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
      }}>
        <h1 style={{ margin: "0 0 4px", fontSize: "22px", fontWeight: 700, color: "#10243f" }}>
          THERASSISTANT
        </h1>
        <p style={{ margin: "0 0 20px", fontSize: "13px", color: "#6b7280" }}>
          EHR account access
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 20 }}>
          <button
            type="button"
            onClick={() => switchMode("login")}
            style={{
              padding: "9px 10px",
              borderRadius: 8,
              border: mode === "login" ? "1px solid #10243f" : "1px solid #d1d5db",
              background: mode === "login" ? "#10243f" : "#fff",
              color: mode === "login" ? "#fff" : "#10243f",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Login
          </button>
          <button
            type="button"
            onClick={() => switchMode("register")}
            style={{
              padding: "9px 10px",
              borderRadius: 8,
              border: mode === "register" ? "1px solid #10243f" : "1px solid #d1d5db",
              background: mode === "register" ? "#10243f" : "#fff",
              color: mode === "register" ? "#fff" : "#10243f",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Register
          </button>
        </div>

        <form onSubmit={mode === "login" ? handleLogin : handleRegister}>
          {mode === "register" && (
            <label style={{ display: "block", marginBottom: "16px" }}>
              <span style={{ fontSize: "13px", fontWeight: 500, color: "#374151", display: "block", marginBottom: "6px" }}>
                Full name
              </span>
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Jane Doe"
                style={{
                  width: "100%",
                  padding: "9px 12px",
                  border: "1px solid #d1d5db",
                  borderRadius: "6px",
                  fontSize: "14px",
                  boxSizing: "border-box",
                  outline: "none",
                }}
              />
            </label>
          )}

          <label style={{ display: "block", marginBottom: "16px" }}>
            <span style={{ fontSize: "13px", fontWeight: 500, color: "#374151", display: "block", marginBottom: "6px" }}>
              Email
            </span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
              style={{
                width: "100%",
                padding: "9px 12px",
                border: "1px solid #d1d5db",
                borderRadius: "6px",
                fontSize: "14px",
                boxSizing: "border-box",
                outline: "none",
              }}
            />
          </label>

          <label style={{ display: "block", marginBottom: mode === "register" ? "16px" : "24px" }}>
            <span style={{ fontSize: "13px", fontWeight: 500, color: "#374151", display: "block", marginBottom: "6px" }}>
              Password
            </span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              style={{
                width: "100%",
                padding: "9px 12px",
                border: "1px solid #d1d5db",
                borderRadius: "6px",
                fontSize: "14px",
                boxSizing: "border-box",
                outline: "none",
              }}
            />
          </label>

          {mode === "register" && (
            <label style={{ display: "block", marginBottom: "24px" }}>
              <span style={{ fontSize: "13px", fontWeight: 500, color: "#374151", display: "block", marginBottom: "6px" }}>
                Confirm password
              </span>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                style={{
                  width: "100%",
                  padding: "9px 12px",
                  border: "1px solid #d1d5db",
                  borderRadius: "6px",
                  fontSize: "14px",
                  boxSizing: "border-box",
                  outline: "none",
                }}
              />
            </label>
          )}

          {error && (
            <p style={{
              margin: "0 0 16px",
              padding: "10px 12px",
              background: "#fef2f2",
              border: "1px solid #fecaca",
              borderRadius: "6px",
              fontSize: "13px",
              color: "#dc2626",
            }}>
              {error}
            </p>
          )}

          {message && (
            <p style={{
              margin: "0 0 16px",
              padding: "10px 12px",
              background: "#ecfeff",
              border: "1px solid #a5f3fc",
              borderRadius: "6px",
              fontSize: "13px",
              color: "#155e75",
            }}>
              {message}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              width: "100%",
              padding: "10px",
              background: loading ? "#6b7280" : "#10243f",
              color: "#fff",
              border: "none",
              borderRadius: "6px",
              fontSize: "14px",
              fontWeight: 600,
              cursor: loading ? "not-allowed" : "pointer",
            }}
          >
            {loading
              ? mode === "login" ? "Signing in..." : "Creating account..."
              : mode === "login" ? "Sign in" : "Create account"}
          </button>
        </form>
      </div>
    </div>
  );
}
