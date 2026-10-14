import React, { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import { formatDateRange } from '../components/EventCard.jsx';
import { useLang } from '../i18n/LanguageContext.jsx';
import TermsConsent from '../components/TermsConsent.jsx';

const countdown = (expiry) => {
  const diff = new Date(expiry) - Date.now();
  if (diff <= 0) return 'Expired';
  const m = Math.floor(diff / 60000);
  const s = Math.floor((diff % 60000) / 1000);
  return `${m}:${String(s).padStart(2, '0')}`;
};

const providerName = (provider) => ({
  simulated: 'Instant demo',
  paynow: 'PayNow',
  stripe: 'Stripe',
}[provider] || provider);

export default function CheckoutPage() {
  const { bookingId } = useParams();
  const navigate = useNavigate();
  const { t } = useLang();
  const [booking, setBooking] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [provider, setProvider] = useState('simulated');
  const [remaining, setRemaining] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [termsSignal, setTermsSignal] = useState(0);
  const [offers, setOffers] = useState([]);
  const [selected, setSelected] = useState([]);
  const [applying, setApplying] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef(null);

  const loadBooking = async () => {
    const { data } = await api.get(`/api/bookings/${bookingId}`);
    setBooking(data.booking);
    return data.booking;
  };

  useEffect(() => {
    loadBooking()
      .catch((e) => setError(e.message));
  }, [bookingId]);

  // What this customer can spend on this booking drives the dropdown. Refetched
  // after applying so a spent offer drops out of the list.
  const loadOffers = async () => {
    try {
      const { data } = await api.get(`/api/vouchers/available?bookingId=${bookingId}`);
      // `applied` are already consumed by this booking, so the server lists them
      // separately. They have to stay visible and ticked, otherwise the discount
      // sits in the total with nothing selectable and no way to remove it.
      const list = [...(data.applied || []), ...(data.entitlements || [])];
      setOffers(list);
      const usable = new Set(list.map((o) => String(o.id)));
      setSelected((prev) => {
        const applied = (data.applied || []).map((o) => String(o.id));
        return [...new Set([...applied, ...prev])].filter((id) => usable.has(id));
      });
    } catch {
      setOffers([]);
    }
  };

  useEffect(() => {
    if (booking?.status === 'pending') loadOffers();
  }, [bookingId, booking?.status]);

  const toggleOffer = (id) => {
    const key = String(id);
    setSelected((prev) => (prev.includes(key) ? prev.filter((x) => x !== key) : [...prev, key]));
  };

  // Close the offer dropdown on outside click or Escape, so it behaves like the
  // popovers elsewhere in the app.
  useEffect(() => {
    if (!pickerOpen) return undefined;
    const onDown = (e) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target)) setPickerOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setPickerOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [pickerOpen]);

  // Applying an empty selection is how an already-applied voucher is removed, so
  // Apply stays enabled whenever there is anything to change.
  const canApply = selected.length > 0 || (booking?.discount || 0) > 0;

  const selectedTotal = offers
    .filter((o) => selected.includes(String(o.id)))
    .reduce((sum, o) => sum + Number(o.discount || 0), 0);

  const applyOffers = async () => {
    setApplying(true);
    setError('');
    try {
      const { data } = await api.post(`/api/bookings/${bookingId}/entitlements`, {
        entitlements: selected.map(String),
      });
      setBooking(data.booking);
      setPickerOpen(false);
      await loadOffers();
    } catch (e) {
      setError(e.message);
    } finally {
      setApplying(false);
    }
  };

  useEffect(() => {
    if (!booking?.holdExpiresAt) return;
    const iv = setInterval(() => setRemaining(countdown(booking.holdExpiresAt)), 1000);
    return () => clearInterval(iv);
  }, [booking]);

  // Going to Stripe and pressing Back restores this page from bfcache with
  // `busy` still true — the Pay button would be stuck on "Processing payment…"
  // with no way to retry. Clear it when the page is restored.
  useEffect(() => {
    const onPageShow = (e) => {
      if (e.persisted) setBusy(false);
    };
    window.addEventListener('pageshow', onPageShow);
    return () => window.removeEventListener('pageshow', onPageShow);
  }, []);

  const pay = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    if (!agreed) {
      setTermsSignal((s) => s + 1);
      setBusy(false);
      return;
    }
    try {
      const { data } = await api.post('/api/payments/pay', { bookingId, provider });
      if (data.redirectUrl) window.location.href = data.redirectUrl;
      else navigate(`/payment/success?booking=${booking.reference}&provider=${data.provider}`);
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  };

  if (error) return <div className="container"><div className="alert alert-error">{error}</div></div>;
  if (!booking) return <div className="container center route-fallback">{t('common.loading')}</div>;
  if (booking.status !== 'pending') {
    return (
      <div className="container narrow">
        <div className="card">
          <h1>{booking.status === 'confirmed' ? t('checkout.alreadyPaid') : t('checkout.bookingStatus', { status: booking.status })}</h1>
          <p className="muted">{t('checkout.bookingRef')} {booking.reference} · {booking.status}. <a href="/account">{t('checkout.goToMyAccount')}</a></p>
        </div>
      </div>
    );
  }

  const applied = (booking.voucherRedemptions || [])
    .filter((v) => v && v.voucher)
    .map((v) => ({ id: v._id, title: v.voucher.title || v.voucher.code }));

  return (
    <div className="container narrow">
      <div className="card">
        <h1>{t('checkout.checkout')}</h1>
        <p className="muted">{t('checkout.bookingRef')} <strong>{booking.reference}</strong></p>
        <p>{t('checkout.seatsHeld', { time: remaining })}</p>

        <h3>{booking.event?.title || t('checkout.event')}</h3>
        <p className="muted">📅 {formatDateRange(booking.event?.startDate, booking.event?.endDate)} · 📍 {booking.event?.venue?.city}</p>

        <table className="table">
          <thead>
            <tr><th>{t('checkout.category')}</th><th>{t('checkout.date')}</th><th>{t('checkout.qty')}</th><th>{t('checkout.unit')}</th><th>{t('checkout.total')}</th></tr>
          </thead>
          <tbody>
            {booking.items.map((it, i) => (
              <tr key={i}>
                <td>{it.categoryName}{it.seats?.length ? ` · ${it.seats.map((s) => s.label).join(', ')}` : ''}</td>
                <td>{it.sessionDate ? new Date(it.sessionDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '—'}</td>
                <td>{it.qty}</td>
                <td>${it.unitPrice}</td>
                <td>${it.lineTotal}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="offer-picker">
          <h3>{t('checkout.applyDiscount')}</h3>
          {applied.length > 0 && (
            <div className="alert alert-success">
              {t('checkout.appliedNow', { names: applied.map((a) => a.title).join(', ') })}
            </div>
          )}
          {offers.length === 0 ? (
            <p className="muted small">{t('checkout.noOffers')}</p>
          ) : (
            <div className="offer-dropdown" ref={pickerRef}>
              <button
                type="button"
                className="offer-trigger"
                aria-expanded={pickerOpen}
                aria-haspopup="listbox"
                onClick={() => setPickerOpen((o) => !o)}
              >
                <span className="offer-trigger-text">
                  {selected.length === 0
                    ? t('checkout.pickerEmpty')
                    : t('checkout.pickerSummary', { n: selected.length, amount: selectedTotal.toFixed(2) })}
                </span>
                <span className="offer-caret" aria-hidden="true">{pickerOpen ? '▲' : '▼'}</span>
              </button>
              {pickerOpen && (
                <div className="offer-menu">
                  <p className="muted small offer-menu-hint">{t('checkout.offersHint')}</p>
                  {offers.map((o) => {
                    const key = String(o.id);
                    const on = selected.includes(key);
                    return (
                      <label className={`offer-row${on ? ' on' : ''}`} key={key}>
                        <input type="checkbox" checked={on} onChange={() => toggleOffer(o.id)} />
                        <span className="offer-label">
                          <span className="offer-title">{o.title}</span>
                          <span className="offer-meta">
                            {t('checkout.offerOff', { amount: o.discount })}
                            {o.isGiftCard ? ` · ${t('checkout.offerAnyEvent')}` : ''}
                          </span>
                        </span>
                        <span className={`pill ${o.isGiftCard ? 'st-confirmed' : 'st-pending'}`}>
                          {o.applied ? t('checkout.appliedPill') : (o.isGiftCard ? t('checkout.giftCard') : t('checkout.voucher'))}
                        </span>
                      </label>
                    );
                  })}
                  {/* Inside the popover on purpose: as a sibling it sat underneath
                      the absolutely-positioned menu, which swallowed the click on
                      Apply. */}
                  <div className="row-gap offer-actions">
                    <button className="btn btn-dark btn-sm" disabled={applying || !canApply} onClick={applyOffers}>
                      {applying ? t('common.saving') : t('checkout.applySelected', { n: selected.length })}
                    </button>
                    {selected.length > 0 && (
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSelected([])}>
                        {t('checkout.pickerClear')}
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="totals">
          <div className="row-line"><span>{t('checkout.subtotal')}</span><span>${booking.subtotal}</span></div>
          {booking.discount > 0 && (
            <div className="row-line"><span>{t('checkout.discount', { name: booking.discountName })}</span><span className="success">-${booking.discount}</span></div>
          )}
          <div className="row-line total"><span>{t('checkout.totalLabel', { currency: booking.currency })}</span><span>${booking.total}</span></div>
        </div>

        <fieldset className="pay-methods">
          <legend>{t('checkout.paymentMethod')}</legend>
          <label>
            <input type="radio" name="pm" checked={provider === 'simulated'} onChange={() => setProvider('simulated')} />
            <span>{t('checkout.simulated')}<br /><small className="muted">{t('checkout.simulatedSub')}</small></span>
          </label>
          <label>
            <input type="radio" name="pm" checked={provider === 'paynow'} onChange={() => setProvider('paynow')} />
            <span>{t('checkout.paynow')}<br /><small className="muted">{t('checkout.paynowSub')}</small></span>
          </label>
          <label>
            <input type="radio" name="pm" checked={provider === 'stripe'} onChange={() => setProvider('stripe')} />
            <span>{t('checkout.cardStripe')}<br /><small className="muted">{t('checkout.cardStripeSub')}</small></span>
          </label>
        </fieldset>

        {error && <div className="alert alert-error">{error}</div>}

        <TermsConsent checked={agreed} onChange={setAgreed} kind="checkout" openSignal={termsSignal} />

        <button className="btn btn-dark full" disabled={busy} onClick={pay}>
          {busy ? t('checkout.processingPayment') : t('checkout.pay', { total: booking.total, provider: providerName(provider) })}
        </button>
        <p className="muted small">{t('checkout.confirmationNote')}</p>
      </div>
    </div>
  );
}