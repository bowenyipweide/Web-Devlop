import React, { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import { useLang } from '../i18n/LanguageContext.jsx';

// Landing spot for Stripe's cancel_url. It used to fall through to HomePage,
// which left a buyer whose checkout session died (cancelled, completed in
// another tab, or past its TTL) with no way back to a working payment. Resolve
// the booking from the reference Stripe sends back and offer real recovery.
export default function PaymentCancelPage() {
  const { t } = useLang();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [booking, setBooking] = useState(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const ref = params.get('booking');
    (async () => {
      try {
        const { data } = await api.get('/api/bookings');
        const list = data.bookings || [];
        setBooking((ref && list.find((b) => b.reference === ref)) || list[0] || null);
      } catch {
        setBooking(null);
      } finally {
        setLoaded(true);
      }
    })();
  }, [params]);

  if (!loaded) return <div className="container center route-fallback">{t('common.loading')}</div>;

  const paid = booking?.status === 'confirmed';
  const pending = booking?.status === 'pending';

  return (
    <div className="container narrow">
      <div className="card">
        <h1>{paid ? t('paymentCancel.alreadyPaid') : t('paymentCancel.title')}</h1>
        <p className="muted">
          {paid
            ? t('paymentCancel.paidNote', { ref: booking.reference })
            : t('paymentCancel.note')}
        </p>
        <div className="row-gap">
          {paid && (
            <button className="btn btn-dark" onClick={() => navigate('/account#tickets')}>
              {t('paymentCancel.viewETickets')}
            </button>
          )}
          {pending && (
            <button className="btn btn-dark" onClick={() => navigate(`/checkout/${booking._id}`)}>
              {t('paymentCancel.retry')}
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
