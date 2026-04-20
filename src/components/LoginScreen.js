import React, { useState } from 'react';

const SESSION_KEY = 'tf_auth';

async function sha256(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
}

export function getStoredPasswordHash() {
  return localStorage.getItem('tf_pw_hash') || '';
}

export function isAuthEnabled() {
  return !!localStorage.getItem('tf_pw_hash');
}

export function isAuthenticated() {
  return sessionStorage.getItem(SESSION_KEY) === 'yes';
}

export function logout() {
  sessionStorage.removeItem(SESSION_KEY);
  window.location.reload();
}

export default function LoginScreen({ onLogin }) {
  const [password, setPassword] = useState('');
  const [error,    setError]    = useState('');
  const [loading,  setLoading]  = useState(false);

  const handleLogin = async (e) => {
    e.preventDefault();
    if (!password) return;
    setLoading(true);
    setError('');
    try {
      const hash = await sha256(password);
      const stored = getStoredPasswordHash();
      if (hash === stored) {
        sessionStorage.setItem(SESSION_KEY, 'yes');
        if (onLogin) onLogin();
        else window.location.reload();
      } else {
        setError('Incorrect password. Try again.');
        setPassword('');
      }
    } catch {
      setError('Something went wrong. Try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--bg)', fontFamily: 'var(--font)',
    }}>
      <div style={{
        width: '100%', maxWidth: 380, padding: '40px 36px',
        background: 'var(--bg-card)', border: '1px solid var(--border)',
        borderRadius: 16, boxShadow: '0 24px 64px rgba(0,0,0,.5)',
      }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ fontSize: 40, marginBottom: 10 }}>📈</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-primary)' }}>
            Trade<span style={{ color: 'var(--blue-bright)' }}>Folio</span>
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 6 }}>
            Enter your password to continue
          </div>
        </div>

        <form onSubmit={handleLogin}>
          <div style={{ marginBottom: 16 }}>
            <input
              className="form-control"
              type="password"
              placeholder="Password"
              value={password}
              onChange={e => { setPassword(e.target.value); setError(''); }}
              autoFocus
              style={{ textAlign: 'center', fontSize: 16, letterSpacing: 2, padding: '12px 16px' }}
            />
          </div>

          {error && (
            <div style={{
              background: 'var(--red-dim)', color: 'var(--red)', borderRadius: 8,
              padding: '8px 12px', fontSize: 13, marginBottom: 14, textAlign: 'center',
            }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            className="btn btn-primary"
            disabled={loading || !password}
            style={{ width: '100%', justifyContent: 'center', padding: 12, fontSize: 15 }}
          >
            {loading ? '⏳ Checking...' : '🔓 Unlock'}
          </button>
        </form>

        <div style={{ marginTop: 20, fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', lineHeight: 1.6 }}>
          Session expires when you close the browser tab.
        </div>
      </div>
    </div>
  );
}
