import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { api } from '../api/client.js';
import { formatDateRange } from '../components/EventCard.jsx';
import { useNavigate } from 'react-router-dom';
import { useLang } from '../i18n/LanguageContext.jsx';

export default function ResaleMarket() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { t } = useLang();
  const [listings, setListings] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get('/api/tickets/resale/market')
      .then(({ data }) => setListings(data.listings))
      .catch((e) => setError(e.message));
  }, []);

  const buy = async (id, price) => {
    if (!user) { navigate('/login', { state: { from: '/resale' } }); return; }
    if (!window.confirm(t('resale.confirm', { price }))) return;
    setBusy(true);
    setError('');
    try {
      await api.post(`/api/tickets/resale/${id}/buy`, {});
      window.alert(t('resale.success'));
      setListings((l) => l.filter((x) => x._id !== id));
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  const fmtDate = (d) => new Date(d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });

  return (
    <div className="container">
      <h1>{t('resale.title')}</h1>
      <p className="muted">{t('resale.intro')}</p>
      {error && <div className="alert alert-error">{error}</div>}
      <div className="event-grid">
        {listings.map((l) => (
          <div className="event-card" key={l._id}>
            <div className="event-card-img">
              <img src={l.event?.image} alt="" loading="lazy" />
              <span className="event-cat">RESALE</span>
            </div>
            <div className="event-card-body">
              <h3>{l.event?.title}</h3>
              <p className="muted row-gap">
                <span>📅 {l.ticket?.sessionDate ? fmtDate(l.ticket.sessionDate) : formatDateRange(l.event?.startDate, l.event?.endDate)}</span>
                <span>📍 {l.event?.venue?.city}</span>
              </p>
              <p className="muted small">{t('resale.seat')}: {l.ticket?.seatLabel || t('validate.generalAdmission')} · {l.seller?.name}</p>
              <div className="event-card-foot">
                <span className="price">${l.price}</span>
                <button className="btn btn-dark btn-sm" disabled={busy} onClick={() => buy(l._id, l.price)}>{t('resale.buyResale')}</button>
              </div>
            </div>
          </div>
        ))}
        {!listings.length && !error && <p className="muted">{t('resale.none')}</p>}
      </div>
    </div>
  );
}