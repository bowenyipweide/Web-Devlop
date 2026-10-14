import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useLang } from '../i18n/LanguageContext.jsx';

export default function TransferClaim() {
  const { transferCode } = useParams();
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const { t } = useLang();
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const claim = async () => {
    if (!user) { navigate('/login', { state: { from: `/transfer/${transferCode}` } }); return; }
    setBusy(true);
    setError('');
    try {
      await api.post(`/api/tickets/transfer/${transferCode}/claim`, {});
      setMsg(t('transfer.success'));
      setTimeout(() => navigate('/account#tickets'), 1800);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  if (loading) return <div className="container center" style={{ padding: '4rem 0' }}>{t('common.loading')}</div>;

  return (
    <div className="container narrow">
      <div className="card auth-card">
        <h1>{t('transfer.title')}</h1>
        <p className="muted">{t('transfer.intro')}</p>
        <p><strong>{t('transfer.codeLabel')}</strong> <code>{transferCode}</code></p>
        {msg && <div className="alert alert-info">{msg}</div>}
        {error && <div className="alert alert-error">{error}</div>}
        <button className="btn btn-dark full" disabled={busy} onClick={claim}>{busy ? t('transfer.claiming') : t('transfer.claim')}</button>
      </div>
    </div>
  );
}