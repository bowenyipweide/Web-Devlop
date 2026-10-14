import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import { formatDateRange } from '../components/EventCard.jsx';
import { useLang } from '../i18n/LanguageContext.jsx';

export default function OrganizerDashboard() {
  const { t } = useLang();
  const [dashboard, setDashboard] = useState(null);
  const [analytics, setAnalytics] = useState(null);
  const [forecast, setForecast] = useState(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get('/api/organizer/dashboard').then(({ data }) => setDashboard(data));
    api.get('/api/organizer/analytics/sales?days=30').then(({ data }) => setAnalytics(data));
    api.get('/api/organizer/analytics/forecast').then(({ data }) => setForecast(data)).catch(() => {});
  }, []);

  const submit = async (id) => {
    setBusy(true);
    try { await api.post(`/api/events/manage/${id}/submit`, {}); setMsg(t('organizer.submitted')); window.location.reload(); }
    catch (e) { setMsg(e.message); } finally { setBusy(false); }
  };
  const cancelEvent = async (id) => {
    if (!window.confirm(t('organizer.cancelConfirm'))) return;
    try { await api.post(`/api/events/manage/${id}/cancel`, {}); setMsg(t('organizer.eventCancelled')); window.location.reload(); }
    catch (e) { setMsg(e.message); }
  };

  if (!dashboard) return <div className="container center" style={{ padding: '4rem 0' }}>{t('organizer.loading')}</div>;

  const maxRevenue = Math.max(...(analytics?.series || []).map((s) => s.revenue), 1);

  return (
    <div className="container">
      <div className="acct-head">
        <div>
          <h1>{t('organizer.dashboard')}</h1>
          <p className="muted">{t('organizer.statsLine', { events: dashboard.summary.events, tickets: dashboard.summary.seatsSold, revenue: dashboard.summary.revenue.toLocaleString() })}</p>
        </div>
        <div className="row-gap">
          <Link className="btn btn-dark" to="/organizer/new">{t('organizer.createEvent')}</Link>
          <Link className="btn btn-ghost" to="/organizer/validate">{t('organizer.entryScan')}</Link>
          <Link className="btn btn-ghost" to="/account#profile">{t('organizer.changePassword')}</Link>
        </div>
      </div>

      {msg && <div className="alert alert-info">{msg}</div>}

      <div className="stat-row">
        <div className="stat"><strong>{dashboard.summary.events}</strong><span>{t('organizer.totalEvents')}</span></div>
        <div className="stat"><strong>{dashboard.summary.published}</strong><span>{t('organizer.published')}</span></div>
        <div className="stat"><strong>{dashboard.summary.seatsSold}</strong><span>{t('organizer.ticketsSold')}</span></div>
        <div className="stat"><strong>${dashboard.summary.revenue.toLocaleString()}</strong><span>{t('organizer.grossRevenue')}</span></div>
      </div>

      <h2>{t('organizer.yourEvents')}</h2>
      <div className="card-list">
        {dashboard.rows.map((e) => (
          <div className="card row-card" key={e.id}>
            <div className="row-card-main">
              <h3>{e.title} <span className="muted small">{e.category}</span></h3>
              <p className="muted">{t('organizer.eventLine', { date: formatDateRange(e.startDate, e.endDate), sold: e.salesCount, revenue: e.revenue.toLocaleString(), pct: e.soldPct })}</p>
              {e.approval === 'pending' && <span className="pill st-pending">{t('organizer.inReview')}</span>}
              {e.approval === 'approved' && <span className={`pill st-${e.status}`}>{e.status}</span>}
              {e.editReviewStatus === 'pending' && <span className="pill st-pending">{t('organizer.editInReview')}</span>}
            </div>
            <div className="row-card-side">
              <a className="btn btn-ghost btn-sm" href={`/events/${e.slug}`}>{t('organizer.view')}</a>
              <Link className="btn btn-ghost btn-sm" to={`/organizer/edit/${e.id}`}>{t('organizer.edit')}</Link>
              {e.approval === 'rejected' && e.status === 'draft' && <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => submit(e.id)}>{t('organizer.submitAgain')}</button>}
              {e.approval === 'pending' && e.status === 'draft' && <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => submit(e.id)}>{t('organizer.submitForReview')}</button>}
              {e.editReviewStatus === 'rejected' && <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => submit(e.id)}>{t('organizer.resubmitEdit')}</button>}
              {e.status === 'published' && <button className="btn btn-ghost btn-sm danger-text" onClick={() => cancelEvent(e.id)}>{t('organizer.cancel')}</button>}
            </div>
          </div>
        ))}
      </div>

      {analytics && (
        <>
          <h2>{t('organizer.sales30')}</h2>
          <div className="bar-chart">
            {analytics.series.map((s) => (
              <div className="bar-col" key={s._id} title={`${s._id}: $${s.revenue} · ${s.bookings} bookings`}>
                <div className="bar" style={{ height: `${Math.max(2, (s.revenue / maxRevenue) * 100)}%` }}></div>
                <span className="bar-label">{s._id.slice(8)}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {forecast && forecast.forecast.length > 0 && (
        <>
          <h2>{t('organizer.demandForecast')}</h2>
          <div className="card small">
            {forecast.forecast.map((f) => (
              <div className="row-line" key={f.day}><span>{f.day}</span><strong>${Math.round(f.predictedRevenue)}</strong></div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}