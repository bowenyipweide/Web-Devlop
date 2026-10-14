import React, { useEffect, useRef, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useLang } from '../i18n/LanguageContext.jsx';

// Keep the browser return path to a single confirmation request. Finalising a
// paid session is the webhook's job; the customer is never made to wait through
// repeated API/Stripe polling. One call, then /account has the latest data.
const CONFIRM_TIMEOUT_MS = 15000;

// Server messages for a session Stripe refuses to report on: completed
// elsewhere, cancelled, or past its TTL (Stripe's own init fails with
// `checkout_not_active_session` in that state).
const isSessionInactive = (msg = '') =>
  /checkout session (?:has expired|is no longer active)|checkout_not_active|not active session/i.test(msg);

export default function PaymentSuccessPage() {
  const { t } = useLang();
  const { refresh } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [state, setState] = useState({ status: 'confirming', booking: null });
  // React 18 StrictMode mounts effects twice in dev. Without this guard both
  // mounts fire a confirm-session call at the same instant.
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const ref = params.get('booking');
    const sessionId = params.get('session_id');

    const resolveBooking = async (known) => {
      if (known) return known;
      const { data } = await api.get('/api/bookings');
      return ref ? data.bookings.find((b) => b.reference === ref) : data.bookings[0];
    };

    const confirm = async () => {
      try {
        if (sessionId) {
          const { data } = await api.post(
            '/api/payments/confirm-session',
            { sessionId, bookingRef: ref || undefined },
            { timeout: CONFIRM_TIMEOUT_MS }
          );
          if (data.status === 'confirmed') {
            // The purchase earned loyalty points, but the cached auth user
            // still has the pre-purchase balance, so pull the updated profile
            // before /account reads user.loyaltyPoints.
            await refresh();
            setState({ status: 'done', booking: data.booking });
          } else {
            // Do not hammer the API. Stripe's webhook confirms the payment and
            // issues tickets server-side; /account refetches on mount.
            setState({ status: 'settling', booking: null });
          }
          return;
        }

        const booking = await resolveBooking();
        if (booking?.status === 'confirmed') await refresh();
        setState({ status: booking?.status === 'confirmed' ? 'done' : 'settling', booking });
      } catch (e) {
        if (sessionId && isSessionInactive(e.message)) {
          // Never sit on a spinner for a dead session. Try to recover the
          // booking so the buyer can start a fresh checkout in one click; if
          // it turned out to be confirmed anyway, show the success card.
          let resolved = null;
          try { resolved = await resolveBooking(); } catch { /* stay null */ }
          if (resolved?.status === 'confirmed') {
            await refresh();
            setState({ status: 'done', booking: resolved });
          } else {
            setState({ status: 'expired', booking: resolved });
          }
        } else {
          setState({ status: 'error', message: e.message });
        }
      }
    };
    confirm();
  }, [params, refresh]);

  // Always end up on /account: it refetches bookings and tickets on mount, so
  // this is the "refresh" that makes the new e-ticket appear. Only a hard error
  // or an expired session holds the buyer here, because those need explaining.
  useEffect(() => {
    if (state.status === 'confirming' || state.status === 'error' || state.status === 'expired') return undefined;
    const t = setTimeout(() => navigate('/account'), 5000);
    return () => clearTimeout(t);
  }, [state.status, navigate]);

  if (state.status === 'expired') {
    const canRetry = state.booking?.status === 'pending';
    return (
      <div className="container narrow">
        <div className="card">
          <h1>{t('paymentSuccess.expiredTitle')}</h1>
          <p className="muted">{t('paymentSuccess.expiredNote')}</p>
          <div className="row-gap">
            {canRetry && (
              <button className="btn btn-dark" onClick={() => navigate(`/checkout/${state.booking._id}`)}>
                {t('paymentSuccess.tryAgain')}
              </button>
            )}
            <button className="btn btn-ghost" onClick={() => navigate('/account')}>
              {t('paymentSuccess.checkMyBookings')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (state.status === 'error')
    return (
      <div className="container narrow">
        <div className="alert alert-error">{state.message}</div>
        <p className="muted">
          <a href="/account">{t('paymentSuccess.checkMyBookings')}</a>
        </p>
      </div>
    );

  // 'settling' means Stripe has not reported the charge yet. It is not treated
  // as proof of payment — the webhook finalises the booking server-side and the
  // redirect to /account picks up the result, so the buyer just sees progress.
  const settling = state.status === 'settling';
  return (
    <div className="container narrow">
      <div className="card success-card">
        <div className="success-emoji" aria-hidden="true">{settling ? '⏳' : '🎉'}</div>
        <h1>{settling ? t('paymentSuccess.processingTitle') : t('paymentSuccess.success')}</h1>
        <p className="muted">
          {settling
            ? t('paymentSuccess.processingNote')
            : t('paymentSuccess.bookingConfirmed', { ref: state.booking?.reference })}
        </p>
        <p>{t('paymentSuccess.eTicketsWaiting')}</p>
        <button className="btn btn-dark" onClick={() => navigate('/account#tickets')}>
          {t('paymentSuccess.viewMyETickets')}
        </button>
      </div>
    </div>
  );
}
