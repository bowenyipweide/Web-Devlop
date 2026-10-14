import React, { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useLang } from '../i18n/LanguageContext.jsx';

export default function LoginPage() {
  const { login } = useAuth();
  const { t } = useLang();
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const from = location.state?.from || (location.state?.role === 'admin' ? '/admin' : '/account');

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const u = await login(form.email, form.password);
      navigate(u.role === 'admin' ? '/admin' : u.role === 'organizer' ? '/organizer' : from);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="container narrow">
      <div className="card auth-card">
        <h1>{t('auth.welcomeBack')}</h1>
        <p className="muted">{t('auth.loginSubtitle')}</p>
        {error && <div className="alert alert-error">{error}</div>}
        <form onSubmit={submit}>
          <label>{t('auth.email')}
            <input type="email" required autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </label>
          <label>{t('auth.password')}
            <input type="password" required autoComplete="current-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          </label>
          <button className="btn btn-dark full" disabled={busy}>{busy ? t('auth.loggingIn') : t('auth.login')}</button>
        </form>
        <p className="muted small">
          {t('auth.demoAccounts')} <code>demo@eventease.app / DemoPass123!</code> · <code>org1@eventease.app / OrgPass123!</code> · <code>admin@eventease.app / AdminPass123!</code>
        </p>
        <p className="muted">{t('auth.newHere')} <Link to="/register">{t('auth.createAccount')}</Link></p>
      </div>
    </div>
  );
}