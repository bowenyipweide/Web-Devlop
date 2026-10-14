import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useAccessibility } from '../context/AccessibilityContext.jsx';
import { useLang } from '../i18n/LanguageContext.jsx';
import { passwordPolicyKey, PASSWORD_MIN_LENGTH, PASSWORD_PATTERN } from '../utils/password.js';
import { formatDate, formatDateRange } from '../components/EventCard.jsx';

const Tabs = ['bookings', 'tickets', 'resale', 'marketplace', 'vouchers', 'profile'];

export default function AccountPage() {
  const { user, refresh } = useAuth();
  const { prefs, setPref } = useAccessibility();
  const { t } = useLang();
  const [tab, setTab] = useState('bookings');
  const [bookings, setBookings] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [resale, setResale] = useState([]);
  const [rewards, setRewards] = useState([]);
  const [redemptions, setRedemptions] = useState([]);
  const [vouchers, setVouchers] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [qr, setQr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [ticketFilter, setTicketFilter] = useState('all');
  const [ticketSort, setTicketSort] = useState('nearest');
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [secMsg, setSecMsg] = useState('');
  const [secErr, setSecErr] = useState('');
  const [secBusy, setSecBusy] = useState(false);
  const [voucherCode, setVoucherCode] = useState('');

  const load = useCallback(async () => {
    try {
      const [b, tic, r, rw, rd, v, n] = await Promise.all([
        api.get('/api/bookings'),
        api.get('/api/tickets'),
        api.get('/api/tickets/resale/mine'),
        api.get('/api/marketplace/rewards'),
        api.get('/api/marketplace/redemptions'),
        api.get('/api/vouchers/mine'),
        api.get('/api/notifications'),
      ]);
      setBookings(b.data.bookings);
      setTickets(tic.data.tickets);
      setResale(r.data.listings);
      setRewards(rw.data.rewards);
      setRedemptions(rd.data.redemptions);
      setVouchers(v.data.redemptions);
      setNotifications(n.data.notifications);
    } catch (e) { /* ignore */ }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const h = window.location.hash.replace('#', '');
    if (Tabs.includes(h)) setTab(h);
  }, []);

  const cancelBooking = async (id) => {
    const booking = bookings.find((b) => b._id === id);
    if (!booking) return;

    const isConfirmed = booking.status === 'confirmed';
    if (!window.confirm(isConfirmed ? t('account.bookings.refundConfirm') : t('account.bookings.cancelConfirm'))) return;
    setBusy(true);
    try {
      await api.post(`/api/bookings/${id}/cancel`, {});
      setMsg(isConfirmed ? t('account.bookings.refundSubmitted') : t('account.bookings.cancelled'));
      load();
    } catch (e) { setMsg(e.message); } finally { setBusy(false); }
  };

  const showQr = async (code) => {
    try {
      const { data } = await api.get(`/api/tickets/${code}`);
      setQr(data.ticket);
    } catch (e) { setMsg(e.message); }
  };

  const transferTicket = async (code) => {
    try {
      const { data } = await api.post(`/api/tickets/${code}/transfer`, {});
      const link = `${window.location.origin}/transfer/${data.transferCode}`;
      window.prompt(t('account.tickets.transferLinkMsg'), link);
      load();
    } catch (e) { setMsg(e.message); }
  };

  const listResale = async (code, event) => {
    const price = window.prompt(t('account.tickets.resalePrompt', { code, title: event.title }));
    if (!price || isNaN(Number(price))) return;
    setBusy(true);
    try {
      await api.post('/api/tickets/resale/list', { code, price: Number(price) });
      setMsg(t('account.tickets.listed'));
      load();
    } catch (e) { setMsg(e.message); } finally { setBusy(false); }
  };

  const cancelResaleListing = async (id) => {
    if (!window.confirm(t('account.resale.removeConfirm'))) return;
    setBusy(true);
    try {
      const { data } = await api.del(`/api/tickets/resale/${id}`);
      setMsg(data.message || '');
      load();
    } catch (e) { setMsg(e.message); } finally { setBusy(false); }
  };

  const applyOrganizer = async () => {
    const org = window.prompt(t('account.becomeOrganizerPrompt'));
    if (!org) return;
    try {
      await api.post('/api/users/apply-organizer', { organization: org });
      setMsg(t('account.pendingOrganizer'));
      await refresh();
    } catch (e) { setMsg(e.message); }
  };

  const updateProfile = async (patch) => {
    try { await api.patch('/api/users/profile', patch); await refresh(); setMsg(t('account.profile.saved')); }
    catch (e) { setMsg(e.message); }
  };

  const savePassword = async (e) => {
    e.preventDefault();
    setSecErr(''); setSecMsg('');
    if (pw.newPassword.length < PASSWORD_MIN_LENGTH) return setSecErr(t('account.profile.passTooShort'));
    const policyKey = passwordPolicyKey(pw.newPassword);
    if (policyKey) return setSecErr(t(policyKey));
    if (pw.newPassword !== pw.confirm) return setSecErr(t('account.profile.passMismatch'));
    setSecBusy(true);
    try {
      await api.post('/api/auth/change-password', { currentPassword: pw.currentPassword, newPassword: pw.newPassword });
      setSecMsg(t('account.profile.passwordUpdated'));
      setPw({ currentPassword: '', newPassword: '', confirm: '' });
    } catch (err) {
      setSecErr(err.message);
    } finally {
      setSecBusy(false);
    }
  };

  const redeemReward = async (reward) => {
    if (!window.confirm(t('account.marketplace.redeemConfirm', { name: reward.name, pts: reward.pointsRequired }))) return;
    setBusy(true);
    setMsg('');
    try {
      const { data } = await api.post('/api/marketplace/redeem', { rewardId: reward.id });
      await refresh();
      setMsg(
        data.giftCard
          ? t('account.marketplace.redeemedGiftCard', { pts: data.loyaltyPoints, value: data.giftCard.value })
          : t('account.marketplace.redeemed', { pts: data.loyaltyPoints })
      );
      load();
    } catch (e) { setMsg(e.message); } finally { setBusy(false); }
  };

  const redeemVoucher = async (e) => {
    e.preventDefault();
    if (!voucherCode.trim()) return;
    setBusy(true);
    setMsg('');
    try {
      const { data } = await api.post('/api/vouchers/redeem', { code: voucherCode.trim() });
      setMsg(data.message || '');
      setVoucherCode('');
      load();
    } catch (e) { setMsg(e.message); } finally { setBusy(false); }
  };

  const openTab = (t2) => { setTab(t2); window.location.hash = t2; };

  const ticketDate = (tick) => new Date(tick.sessionDate || tick.event?.startDate || tick.createdAt).getTime();
  const nowMs = Date.now();
  const visibleTickets = useMemo(() => {
    const byDate = (arr, dir = 1) => [...arr].sort((a, b) => (ticketDate(a) - ticketDate(b)) * dir);
    if (ticketSort === 'newest') {
      return [...tickets].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    }
    const upcoming = tickets.filter((tick) => ticketDate(tick) >= nowMs);
    const past = tickets.filter((tick) => ticketDate(tick) < nowMs);
    if (ticketFilter === 'upcoming') return byDate(upcoming);
    if (ticketFilter === 'past') return byDate(past, -1);
    return [...byDate(upcoming), ...byDate(past, -1)];
  }, [tickets, ticketFilter, ticketSort, nowMs]);

  const voucherDiscountLabel = (v) => {
    if (!v) return '';
    return v.type === 'percent' ? t('account.vouchers.typePercent', { value: v.value }) : t('account.vouchers.typeFixed', { value: v.value });
  };

  return (
    <div className="container">
      <div className="acct-head">
        <div>
          <h1>{t('account.hi', { name: user?.name })}</h1>
          <p className="muted">
            <span className={`pill ${user.role === 'admin' ? 'pill-admin' : user.role === 'organizer' ? 'pill-org' : 'pill-cust'}`}>{user.role}</span>
            {user?.pendingOrganizer && <span className="pill pill-pending">{t('account.pendingOrganizer')}</span>}
            {' '}· {t('account.loyaltyPoints', { n: user?.loyaltyPoints })} · {t('account.referralCode')} <code>{user?.referralCode}</code>
          </p>
        </div>
        {user?.role === 'customer' && !user?.pendingOrganizer && <button className="btn btn-ghost btn-sm" onClick={applyOrganizer}>{t('account.becomeOrganizer')}</button>}
      </div>

      {msg && <div className="alert alert-info" onClick={() => setMsg('')}>{msg}</div>}

      <nav className="tabs" aria-label="Account sections">
        {Tabs.map((t2) => (
          <button key={t2} className={`tab ${tab === t2 ? 'active' : ''}`} onClick={() => openTab(t2)}>
            {t(`account.tabs.${t2}`)}
          </button>
        ))}
      </nav>

      {tab === 'bookings' && (
        <section className="card-list">
          {bookings.length === 0 && <p className="muted">{t('account.bookings.none')} <a href="/">{t('account.bookings.browseEvents')}</a></p>}
          {bookings.map((b) => (
            <div className="card row-card" key={b._id}>
              <div className="row-card-main">
                <h3>{b.event?.title}</h3>
                <p className="muted">📅 {formatDateRange(b.event?.startDate, b.event?.endDate)} · 📍 {b.event?.venue?.city}<br />{t('account.bookings.itemsLine', { ref: b.reference, items: b.items.map((i) => `${i.categoryName}×${i.qty}${i.sessionDate ? ` (${new Date(i.sessionDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })})` : ''}`).join(', ') })}</p>
                <span className={`pill st-${b.status}`}>{b.status}</span>
              </div>
              <div className="row-card-side">
                <strong>${b.total}</strong>
                {b.status === 'confirmed' && <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => cancelBooking(b._id)}>{t('account.bookings.requestRefund')}</button>}
                {b.status === 'refund_pending' && <button className="btn btn-ghost btn-sm" disabled>{t('account.bookings.refundPending')}</button>}
                {b.status === 'pending' && <a className="btn btn-dark btn-sm" href={`/checkout/${b._id}`}>{t('account.bookings.payNow')}</a>}
              </div>
            </div>
          ))}
        </section>
      )}

      {tab === 'tickets' && (
        <section>
          <div className="ticket-toolbar">
            <div className="session-chips">
              {[
                ['all', t('account.tickets.all')],
                ['upcoming', t('account.tickets.upcoming')],
                ['past', t('account.tickets.archived')],
              ].map(([key, label]) => (
                <button key={key} className={`session-chip${ticketFilter === key ? ' active' : ''}`}
                  onClick={() => setTicketFilter(key)}>{label}</button>
              ))}
            </div>
            <label className="sort-select">{t('account.tickets.sort')}
              <select value={ticketSort} onChange={(e) => setTicketSort(e.target.value)} aria-label="Sort tickets">
                <option value="nearest">{t('account.tickets.sortNearest')}</option>
                <option value="newest">{t('account.tickets.sortNewest')}</option>
              </select>
            </label>
          </div>
          <div className="card-list">
            {tickets.length === 0 && <p className="muted">{t('account.tickets.none')}</p>}
            {tickets.length > 0 && visibleTickets.length === 0 && <p className="muted">{ticketFilter === 'past' ? t('account.tickets.noArchived') : t('account.tickets.noUpcoming')}</p>}
            {visibleTickets.map((tick) => {
              const isPast = ticketDate(tick) < nowMs;
              return (
                <div className="card row-card" key={tick._id}>
                  <div className="row-card-main">
                    <h3>{tick.event?.title} {isPast && <span className="pill pill-m">{t('account.tickets.past')}</span>}</h3>
                    <p className="muted">{tick.seatLabel || 'General admission'} · {tick.categoryName}{tick.sessionDate ? ` · 📅 ${new Date(tick.sessionDate).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}` : ''}<br />Code <code>{tick.code}</code> · <span className={`pill st-${tick.status}`}>{tick.status}</span></p>
                  </div>
                  <div className="row-card-side">
                    <button className="btn btn-dark btn-sm" onClick={() => showQr(tick.code)}>{t('account.tickets.showQr')}</button>
                    {tick.status === 'active' && !isPast && (
                      <>
                        <button className="btn btn-ghost btn-sm" onClick={() => transferTicket(tick.code)}>{t('account.tickets.transfer')}</button>
                        <button className="btn btn-ghost btn-sm" onClick={() => listResale(tick.code, tick.event)}>{t('account.tickets.resell')}</button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {qr && (
            <div className="modal" onClick={(e) => { if (e.target === e.currentTarget) setQr(null); }}>
              <div className="modal-box">
                <h2>{t('account.tickets.qrTitle', { code: qr.code })}</h2>
                <p className="muted">{qr.event?.title}</p>
                {qr.qrCode && <img src={qr.qrCode} alt="Ticket QR code" className="qr-img" />}
                <p><strong>{t('account.tickets.seat')}</strong> {qr.seatLabel || 'General admission'} · <strong>{t('account.tickets.date')}</strong> {qr.sessionDate ? new Date(qr.sessionDate).toLocaleString() : (qr.event ? formatDateRange(qr.event.startDate, qr.event.endDate) : '')}</p>
                <p className="muted small">{t('account.tickets.qrNote')}</p>
                <button className="btn btn-ghost btn-sm" onClick={() => setQr(null)}>{t('common.close')}</button>
              </div>
            </div>
          )}
        </section>
      )}

      {tab === 'resale' && (
        <section className="card-list">
          <p className="muted">{t('account.resale.intro')}</p>
          {resale.length === 0 && <p className="muted">{t('account.resale.none')}</p>}
          {resale.map((l) => (
            <div className="card row-card" key={l._id}>
              <div className="row-card-main">
                <h3>{l.event?.title}</h3>
                <p className="muted">{t('account.resale.listingLine', { code: l.ticket?.code, price: l.price })}</p>
                <span className={`pill st-${l.status}`}>{l.status}</span>
              </div>
              <div className="row-card-side">
                {l.status === 'listed' && (
                  <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => cancelResaleListing(l._id)}>
                    {t('account.resale.removeFromMarket')}
                  </button>
                )}
              </div>
            </div>
          ))}
          <p className="muted small">{t('account.resale.note')}</p>
        </section>
      )}

      {tab === 'marketplace' && (
        <section>
          <div className="acct-head" style={{ marginTop: 0 }}>
            <div>
              <h2>{t('account.marketplace.title')}</h2>
              <p className="muted">{t('account.marketplace.intro')}</p>
            </div>
          </div>
          <div className="reward-grid">
            {rewards.length === 0 && <p className="muted">{t('account.marketplace.noRewards')}</p>}
            {rewards.map((r) => {
              const soldOut = r.remaining <= 0;
              const affordable = (user?.loyaltyPoints || 0) >= r.pointsRequired;
              return (
                <div className="reward-card" key={r.id}>
                  <div className="reward-card-img">
                    <img src={r.image || ''} alt="" loading="lazy" />
                  </div>
                  <div className="reward-card-body">
                    <h3>{r.name}</h3>
                    <p className="muted small">{r.description}</p>
                    {r.isGiftCard && (
                      <p className="muted small">{t('account.marketplace.giftCardNote', { value: r.value })}</p>
                    )}
                    <div className="reward-card-foot">
                      <span className="reward-points">{t('account.marketplace.pointsRequired', { n: r.pointsRequired })}</span>
                      {soldOut
                        ? <span className="badge">{t('account.marketplace.outOfStock')}</span>
                        : <span className="muted reward-stock">{t('account.marketplace.inStock', { n: r.remaining })}</span>}
                    </div>
                    <button
                      className={`btn btn-dark btn-sm full ${!affordable ? 'js-none' : ''}`}
                      disabled={soldOut || !affordable || busy}
                      onClick={() => redeemReward(r)}
                    >
                      {t('account.marketplace.redeem')}
                    </button>
                    {!affordable && <p className="muted small">{t('account.marketplace.notEnough')}</p>}
                  </div>
                </div>
              );
            })}
          </div>

          <h3>{t('account.marketplace.myRedemptions')}</h3>
          <div className="card-list">
            {redemptions.length === 0 && <p className="muted">{t('account.marketplace.noRedemptions')}</p>}
            {redemptions.map((red) => (
              <div className="card row-card" key={red._id}>
                <div className="row-card-main">
                  <h3>{red.rewardName || red.reward?.name}</h3>
                  <p className="muted small">{red.rewardImage && <img src={red.rewardImage} alt="" style={{ maxWidth: 48, borderRadius: 6, verticalAlign: 'middle', marginRight: 8 }} />}{t('account.marketplace.redeemedLabel', { date: formatDate(red.redeemedAt || red.createdAt) })}</p>
                  {red.giftCardCode && (
                    <p className="muted small">
                      {t('account.marketplace.giftCardIssued', { value: red.giftCardValue })}
                      {' '}<code>{red.giftCardCode}</code>
                      {' · '}{t('account.marketplace.giftCardAutoApply')}
                    </p>
                  )}
                </div>
                <div className="row-card-side">
                  <span className="reward-points">{t('account.marketplace.pointsRequired', { n: red.pointsSpent })}</span>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {tab === 'vouchers' && (
        <section className="card-list">
          <div className="card">
            <h2>{t('account.vouchers.title')}</h2>
            <p className="muted">{t('account.vouchers.intro')}</p>
            <form onSubmit={redeemVoucher} className="voucher-redeem">
              <label>{t('account.vouchers.redeemBtn')}
                <input
                  value={voucherCode}
                  onChange={(e) => setVoucherCode(e.target.value)}
                  placeholder={t('account.vouchers.placeholder')}
                  aria-label="Voucher redemption code"
                />
              </label>
              <button className="btn btn-dark" disabled={busy}>{t('account.vouchers.redeem')}</button>
            </form>
          </div>

          {vouchers.length === 0 && <p className="muted">{t('account.vouchers.noVouchers')}</p>}
          {vouchers.map((v) => (
            <div className="card row-card" key={v._id}>
              <div className="row-card-main">
                <h3>{v.voucher?.title || v.voucher?.code}</h3>
                <p className="muted">
                  <code>{v.voucher?.code}</code> · {voucherDiscountLabel(v.voucher)}
                  {v.voucher?.minSpend ? ` · min spend $${v.voucher.minSpend}` : ''}
                </p>
                <p className="muted small">
                  {t('account.vouchers.validFor')}{' '}
                  {/* Loyalty gift cards are platform-wide, so they have no event. */}
                  <strong>{v.event?.title || t('account.vouchers.anyEvent')}</strong>
                  {' · '}
                  {/* redeemedAt/createdAt is when the code was claimed, not when
                      it was spent — showing it as "Redeemed" next to a "Ready to
                      use" pill read as if the credit were already used up. */}
                  {v.used
                    ? t('account.vouchers.usedOn', { date: formatDate(v.usedAt || v.redeemedAt || v.createdAt) })
                    : t('account.vouchers.addedOn', { date: formatDate(v.redeemedAt || v.createdAt) })}
                </p>
              </div>
              <div className="row-card-side">
                <span className={`pill ${v.used ? 'pill-m' : 'st-active'}`}>{v.used ? t('account.vouchers.used') : t('account.vouchers.unused')}</span>
              </div>
            </div>
          ))}
        </section>
      )}

      {tab === 'profile' && (
        <section className="card-list">
          <div className="card">
            <h2>{t('account.profile.security')}</h2>
            {secMsg && <div className="alert alert-success">{secMsg}</div>}
            {secErr && <div className="alert alert-error">{secErr}</div>}
            <form onSubmit={savePassword}>
              <label>{t('account.profile.currentPassword')}
                <input type="password" autoComplete="current-password" value={pw.currentPassword} required
                  onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} />
              </label>
              <label>{t('account.profile.newPassword')}
                <input type="password" autoComplete="new-password" value={pw.newPassword} required minLength={PASSWORD_MIN_LENGTH} pattern={PASSWORD_PATTERN} title={t('auth.passwordRuleHint')}
                  onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} placeholder={t('auth.passwordRuleHint')} />
              </label>
              <label>{t('account.profile.confirmNewPassword')}
                <input type="password" autoComplete="new-password" value={pw.confirm} required minLength={8}
                  onChange={(e) => setPw({ ...pw, confirm: e.target.value })} />
              </label>
              <button className="btn btn-dark" disabled={secBusy}>{secBusy ? t('account.profile.saving') : t('account.profile.updatePassword')}</button>
            </form>
          </div>
          <div className="card">
            <h2>{t('account.profile.notifications')}</h2>
            {['email', 'sms', 'whatsapp'].map((ch) => (
              <label className="switch-row" key={ch}>
                <input type="checkbox" checked={!!user?.notifications?.[ch]} onChange={(e) => updateProfile({ notifications: { ...user.notifications, [ch]: e.target.checked } })} />
                <span>{ch === 'email' ? t('account.profile.emailNotif') : ch === 'sms' ? t('account.profile.smsNotif') : t('account.profile.whatsappNotif')} {ch === 'email' ? t('account.profile.emailNotifNote') : t('account.profile.notifSub')}</span>
              </label>
            ))}
          </div>
          <div className="card">
            <h2>{t('account.profile.accessibility')}</h2>
            <label className="switch-row"><input type="checkbox" checked={prefs.highContrast} onChange={(x) => setPref('highContrast', x.target.checked)} /><span>{t('nav.highContrast')}</span></label>
            <label className="switch-row"><input type="checkbox" checked={prefs.largerText} onChange={(x) => setPref('largerText', x.target.checked)} /><span>{t('nav.largerText')}</span></label>
            <label className="switch-row"><input type="checkbox" checked={prefs.reducedMotion} onChange={(x) => setPref('reducedMotion', x.target.checked)} /><span>{t('nav.reducedMotion')}</span></label>
          </div>
          <div className="card">
            <h2>{t('account.profile.receivedNotifs')}</h2>
            {notifications.length === 0 && <p className="muted">{t('account.profile.noNotifs')}</p>}
            {notifications.map((n) => (
              <div className="notif" key={n._id}>
                <strong>{n.title}</strong>
                <p className="muted small">{n.body}</p>
                <span className="muted smaller">{formatDate(n.createdAt)}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}