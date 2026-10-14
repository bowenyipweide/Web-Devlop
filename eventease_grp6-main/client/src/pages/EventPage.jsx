import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useLang } from '../i18n/LanguageContext.jsx';
import SeatMap from '../components/SeatMap.jsx';
import { formatDate, formatDateRange, CATEGORY_LABELS } from '../components/EventCard.jsx';

const formatSessionDate = (d) => {
  if (!d) return '';
  const dt = new Date(d);
  return dt.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
};

export default function EventPage() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { lang, t } = useLang();

  const [event, setEvent] = useState(null);
  const [seats, setSeats] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [qty, setQty] = useState({});
  const [selectedSeats, setSelectedSeats] = useState([]);
  const [busy, setBusy] = useState(false);
  const [selectedSession, setSelectedSession] = useState(null);

  const tierLabel = (tr) => (lang === 'zh' ? t(`eventPage.tiers.${tr}`) : { vip: 'VIP', standard: 'Standard', concession: 'Concession' }[tr] || tr);

  const fetchEvent = useCallback(() => {
    api.get(`/api/events/${slug}`)
      .then(({ data }) => {
        const evt = data.event;
        setEvent(evt);
        setSeats(data.seats || []);
        if (evt?.sessions?.length && !selectedSession) {
          setSelectedSession(evt.sessions[0].id);
        }
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [slug]);

  useEffect(() => { fetchEvent(); }, [fetchEvent]);

  useEffect(() => {
    if (!event?.reservedSeating || !selectedSession) return;
    api.get(`/api/events/${slug}?session=${selectedSession}`)
      .then(({ data }) => setSeats(data.seats || []))
      .catch(() => {});
    setSelectedSeats([]);
  }, [selectedSession, slug, event?.reservedSeating]);

  const getSessionAvail = (cat) => {
    if (!selectedSession || !cat.sessionAvailability?.length) return null;
    return cat.sessionAvailability.find((s) => String(s.sessionId) === String(selectedSession));
  };

  const primed = useMemo(() => {
    const items = [];
    if (event?.reservedSeating) {
      selectedSeats.forEach((s) => {
        let item = items.find((i) => i.categoryId === s.categoryId);
        if (!item) {
          item = { categoryId: s.categoryId, qty: 0, seatIds: [] };
          items.push(item);
        }
        item.qty += 1;
        item.seatIds.push(s._id);
      });
    } else {
      Object.entries(qty).forEach(([id, n]) => {
        if (n > 0) items.push({ categoryId: id, qty: n });
      });
    }
    return { items, count: items.reduce((s, i) => s + i.qty, 0) };
  }, [event, selectedSeats, qty]);

  const proceedToCheckout = async () => {
    if (!user) {
      navigate('/login', { state: { from: `/events/${slug}` } });
      return;
    }

    if (!event?.id || !primed.items.length) {
      setError(t('eventPage.errorNoSelection'));
      return;
    }

    const items = primed.items.map((item) => ({
      categoryId: String(item.categoryId),
      qty: Number(item.qty),
      sessionId: selectedSession || undefined,
      ...(event.reservedSeating
        ? { seatIds: (item.seatIds || []).map((id) => String(id)) }
        : {}),
    }));

    setBusy(true);
    setError('');
    try {
      const { data } = await api.post('/api/bookings', {
        eventId: String(event.id),
        items,
        // Explicit empty selection: discounts are chosen on the checkout page so
        // the customer sees what stacks before paying.
        entitlements: [],
      });
      navigate(`/checkout/${data.booking._id}`);
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  };

  if (loading) return <div className="container center" style={{ padding: '4rem 0' }}>{t('eventPage.loading')}</div>;
  if (error) return <div className="container"><div className="alert alert-error">{error}</div></div>;
  if (!event) return null;

  const canProceed = primed.count > 0;

  return (
    <div className="container event-page">
      <div className="event-hero">
        <img src={event.image} alt="" className="event-hero-img" />
        <div className="event-hero-info">
          <span className="event-cat static">{lang === 'zh' ? t(`eventCard.category.${event.category}`) : CATEGORY_LABELS[event.category] || event.category}</span>
          <h1>{event.title}</h1>
          <p className="hero-sub">📅 {formatDateRange(event.startDate, event.endDate)} · 📍 {event.venue?.name}, {event.venue?.city}</p>
          {event.description && <p>{event.description}</p>}
          <div className="a11y-flags">
            {event.accessibility?.wheelchair && <span>{t('eventPage.wheelchairAccess')}</span>}
            {event.accessibility?.hearingLoop && <span>{t('eventPage.hearingLoop')}</span>}
            {event.accessibility?.sensory && <span>{t('eventPage.sensoryFriendly')}</span>}
          </div>
        </div>
      </div>

      {event.sessions?.length > 1 && (
        <div className="session-selector">
          <h3>{t('eventPage.chooseDate')}</h3>
          <div className="session-chips">
            {event.sessions.map((s) => {
              const isActive = String(s.id) === String(selectedSession);
              return (
                <button
                  key={s.id}
                  className={`session-chip${isActive ? ' active' : ''}`}
                  onClick={() => { setSelectedSession(s.id); setQty({}); setSelectedSeats([]); }}
                >
                  {formatSessionDate(s.date)}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="ticket-shelf">
        {event.ticketCategories.map((c) => {
          const sessAvail = getSessionAvail(c);
          const soldOut = sessAvail ? sessAvail.soldOut : c.soldOut;
          const available = sessAvail ? sessAvail.available : c.available;
          const price = c.earlyBirdPrice && new Date(c.earlyBirdEnd) > new Date() ? c.earlyBirdPrice : c.price;
          return (
            <div className="ticket-cat" key={c.id}>
              <div className="ticket-cat-top">
                <h3>{c.name} <span className={`tier-tag ${c.tier}`}>{tierLabel(c.tier)}</span></h3>
                <div className="price">
                  {c.earlyBirdPrice && new Date(c.earlyBirdEnd) > new Date() && <span className="strike">${c.price}</span>}
                  <strong>${price}</strong>
                </div>
              </div>
              {soldOut
                ? <span className="badge soldout">{t('eventPage.soldOut')}</span>
                : c.earlyBirdPrice && new Date(c.earlyBirdEnd) > new Date()
                  ? <span className="badge earlybird">{t('eventPage.earlyBirdEnds', { date: formatDate(c.earlyBirdEnd) })}</span>
                  : <span className="muted">{t('eventPage.leftAvailable', { n: available })} {selectedSession && event.sessions?.length > 1 ? t('eventPage.thisDate') : ''}</span>}
              {c.description && <p className="muted small">{c.description}</p>}
              {!event.reservedSeating && !soldOut && (
                <div className="stepper">
                  <button className="btn btn-sm" onClick={() => setQty((q) => ({ ...q, [c.id]: Math.max(0, (q[c.id] || 0) - 1) }))} aria-label={`− ${c.name}`}>−</button>
                  <input type="number" min="0" max={c.maxPerOrder} value={qty[c.id] || 0} onChange={(e) => setQty((q) => ({ ...q, [c.id]: Math.max(0, Math.min(c.maxPerOrder, Number(e.target.value) || 0)) }))} aria-label={c.name} />
                  <button className="btn btn-sm" onClick={() => setQty((q) => ({ ...q, [c.id]: Math.min(c.maxPerOrder, (q[c.id] || 0) + 1) }))} aria-label={`+ ${c.name}`}>+</button>
                  <span className="muted small">{t('eventPage.maxPerOrder', { n: c.maxPerOrder })}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {event.reservedSeating && (
        <div className="seat-area">
          <h2>{t('eventPage.pickYourSeats')}</h2>
          <SeatMap seats={seats} onSelection={setSelectedSeats} limit={6} />
        </div>
      )}

      <div className="checkout-bar">
        <span>
          {event.reservedSeating
            ? (selectedSeats.length ? t('eventPage.seatsSelected', { n: selectedSeats.length }) : t('eventPage.selectSeatsOnMap'))
            : t('eventPage.ticketsSelected', { n: primed.count })}
        </span>
        <div className="checkout-actions">
          <button className="btn btn-dark" disabled={!canProceed || busy} onClick={proceedToCheckout}>
            {busy ? t('eventPage.reserving') : t('eventPage.continueToCheckout')}
          </button>
        </div>
      </div>
      {error && <div className="alert alert-error">{error}</div>}
    </div>
  );
}