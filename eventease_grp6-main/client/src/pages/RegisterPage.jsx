import React, { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useLang } from '../i18n/LanguageContext.jsx';
import { passwordPolicyKey, PASSWORD_MIN_LENGTH, PASSWORD_PATTERN } from '../utils/password.js';
import TermsConsent from '../components/TermsConsent.jsx';

export default function RegisterPage() {
  const { register } = useAuth();
  const { t } = useLang();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [role, setRole] = useState(params.get('role') === 'organizer' ? 'organizer' : 'customer');
  const [form, setForm] = useState({
    name: '', email: '', password: '', confirm: '', organization: '', referralCode: '',
    accessibility: {},
  });
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (form.password !== form.confirm) return setError(t('auth.passwordsMismatch'));
    const policyKey = passwordPolicyKey(form.password);
    if (policyKey) return setError(t(policyKey));
    if (!agreed) return setError(t('auth.needTerms'));

    setBusy(true);
    try {
      const u = await register({
        name: form.name, email: form.email, password: form.password,
        role, organization: form.organization || undefined,
        referralCode: form.referralCode || undefined,
      });
      navigate(u.role === 'organizer' ? '/organizer' : '/account');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="container narrow">
      <div className="card auth-card">
        <h1>{t('auth.signupTitle')}</h1>
        <div className="seg">
          <button className={`seg-btn ${role === 'customer' ? 'active' : ''}`} onClick={() => setRole('customer')}>{t('auth.iBuyTickets')}</button>
          <button className={`seg-btn ${role === 'organizer' ? 'active' : ''}`} onClick={() => setRole('organizer')}>{t('auth.iOrganiseEvents')}</button>
        </div>

        {error && <div className="alert alert-error">{error}</div>}
        <form onSubmit={submit}>
          <label>{t('auth.fullName')}
            <input required autoComplete="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </label>
          <label>{t('auth.email')}
            <input type="email" required autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </label>
          <label>{t('auth.password')} <span className="muted small">{t('auth.passwordRuleHint')}</span>
            <input type="password" required autoComplete="new-password" minLength={PASSWORD_MIN_LENGTH} pattern={PASSWORD_PATTERN} title={t('auth.passwordRuleHint')} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          </label>
          <label>{t('auth.confirmPassword')}
            <input type="password" required autoComplete="new-password" value={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value })} />
          </label>
          {role === 'organizer' && (
            <label>{t('auth.orgName')}
              <input required value={form.organization} onChange={(e) => setForm({ ...form, organization: e.target.value })} placeholder={t('auth.orgPlaceholder')} />
              <p className="muted small">{t('auth.orgNote')}</p>
            </label>
          )}
          <label>{t('auth.referralCode')} <span className="muted small">({t('common.optional')})</span>
            <input value={form.referralCode} onChange={(e) => setForm({ ...form, referralCode: e.target.value })} placeholder="e.g. DEMO01" />
          </label>
          <TermsConsent checked={agreed} onChange={setAgreed} kind="signup" />
          <button className="btn btn-dark full" disabled={busy}>{busy ? t('auth.creatingAccount') : t('auth.createAccountBtn')}</button>
        </form>
        <p className="muted">{t('auth.alreadyHaveAccount')} <Link to="/login">{t('auth.login')}</Link></p>
      </div>
    </div>
  );
}