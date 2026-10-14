import React, { useState } from 'react';
import { api } from '../api/client.js';
import { useLang } from '../i18n/LanguageContext.jsx';

export default function ValidateTicket() {
  const { t } = useLang();
  const [code, setCode] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const scan = async (e) => {
    e.preventDefault();
    if (!code.trim()) return;
    setBusy(true);
    setError('');
    setResult(null);
    try {
      const { data } = await api.post('/api/tickets/validate', { code });
      setResult(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="container narrow">
      <div className="card">
        <h1>{t('validate.title')}</h1>
        <p className="muted">{t('validate.intro')}</p>

        <form onSubmit={scan} className="scanner-form">
          <label>{t('validate.codeLabel')}
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder={t('validate.codePlaceholder')}
              autoFocus
              aria-label={t('validate.codeLabel')}
            />
          </label>
          <button className="btn btn-dark full" disabled={busy}>{busy ? t('validate.validating') : t('validate.validate')}</button>
        </form>

        {error && <div className="alert alert-error">{error}</div>}

        {result && (
          <div className={`scan-result ${result.valid ? 'ok' : 'no'}`} role="status">
            <div className="scan-icon" aria-hidden="true">{result.valid ? '✅' : '⛔'}</div>
            <h2>{result.valid ? t('validate.validEntry') : result.reason?.replace('_', ' ').toUpperCase()}</h2>
            <p className="muted">{t('validate.entryOf', { entry: result.entry, allowed: result.allowedEntries || 1 })}</p>
            {result.ticket && (
              <div className="scan-ticket">
                <p><strong>{result.ticket.title}</strong></p>
                <p className="muted">{t('validate.seat')} {result.ticket.seatLabel || t('validate.generalAdmission')}<br />Code: <code>{result.ticket.code}</code></p>
              </div>
            )}
          </div>
        )}
        <p className="muted small">{t('validate.note')}</p>
      </div>
    </div>
  );
}