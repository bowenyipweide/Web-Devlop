import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import { useLang } from '../i18n/LanguageContext.jsx';
import { formatDateRange } from '../components/EventCard.jsx';

const Tabs = ['overview', 'users', 'moderation', 'refunds', 'fraud', 'rewards', 'vouchers'];

const money = (v) => (v == null || v === '' ? '—' : `$${v}`);
const fmtDateFull = (v) => {
  if (!v) return null;
  const d = new Date(v);
  if (isNaN(d.getTime())) return null;
  return `${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

// Build a human-readable "before → after" list from the current event and the
// organizer's pending edit proposal.
const buildDiffLines = (ev, prop, t) => {
  const out = [];
  const add = (field, oldV, newV, desc = (x) => (x == null ? '—' : String(x))) => {
    if (newV === undefined) return; // not part of the proposal → unchanged
    if (desc(oldV) === desc(newV)) return;
    out.push({ field, old: desc(oldV), new: desc(newV) });
  };

  add(t('admin.diff.title'), ev.title, prop.title);
  add(t('admin.diff.category'), ev.category, prop.category);
  add(t('admin.diff.description'), ev.description, prop.description);
  add(t('admin.diff.image'), ev.image, prop.image);
  const ven = (v) => (v ? `${v.name}${v.address ? ', ' + v.address : ''}, ${v.city}` : '');
  add(t('admin.diff.venue'), ven(ev.venue), ven(prop.venue));
  add(t('admin.diff.start'), ev.startDate, prop.startDate, fmtDateFull);
  if (ev.endDate && String(ev.endDate) !== String(ev.startDate)) {
    add(t('admin.diff.end'), ev.endDate, prop.endDate || null, fmtDateFull);
  } else if (prop.endDate && String(prop.endDate) !== String(prop.startDate)) {
    add(t('admin.diff.end'), null, prop.endDate, fmtDateFull);
  }
  add(t('admin.diff.reserved'), ev.reservedSeating, prop.reservedSeating, (x) => (x ? 'Yes' : 'No'));
  const acc = (a) => (a ? [t('eventPage.wheelchairAccess'), t('eventPage.hearingLoop'), t('eventPage.sensoryFriendly')].filter((_, i) => !!a[['wheelchair', 'hearingLoop', 'sensory'][i]]).join(', ') || 'None' : 'None');
  add(t('admin.diff.accessibility'), acc(ev.accessibility), acc(prop.accessibility));
  const promo = (p) => (p && p.enabled ? (p.message || 'Banner enabled') : 'None');
  add(t('admin.diff.promo'), promo(ev.promo), promo(prop.promo));

  // Ticket categories
  const ckey = (c) => String(c.name || '').trim().toLowerCase();
  const catSum = (c) => `${money(c.price)} · ${c.qty} · ${c.tier}${c.earlyBirdPrice ? ` · ${money(c.earlyBirdPrice)}` : ''}`;
  const catsOld = (ev.ticketCategories || []).reduce((m, c) => m.set(ckey(c), c), new Map());
  const catsNew = (prop.ticketCategories || []).reduce((m, c) => m.set(ckey(c), c), new Map());
  for (const nc of prop.ticketCategories || []) if (!catsOld.has(ckey(nc))) out.push({ field: `Category “${nc.name}”`, old: '—', new: `added: ${catSum(nc)}` });
  for (const oc of ev.ticketCategories || []) if (!catsNew.has(ckey(oc))) out.push({ field: `Category “${oc.name}”`, old: `removed: ${catSum(oc)}`, new: '—' });
  for (const nc of prop.ticketCategories || []) {
    const oc = catsOld.get(ckey(nc));
    if (oc && catSum(oc) !== catSum(nc)) out.push({ field: `Category “${nc.name}”`, old: catSum(oc), new: catSum(nc) });
  }

  // Seating layout sections
  const skey = (s) => String(s.name || '').trim().toLowerCase();
  const secSum = (s) => `${money(s.price)} · ${s.rows} rows × ${s.cols} seats · starts ${s.startingRow || 'A'}`;
  const secsOld = (ev.currentSections || []).reduce((m, s) => m.set(skey(s), s), new Map());
  const secsNew = (prop.sections || []).reduce((m, s) => m.set(skey(s), s), new Map());
  for (const ns of prop.sections || []) if (!secsOld.has(skey(ns))) out.push({ field: `Section “${ns.name}”`, old: '—', new: `added: ${secSum(ns)}` });
  for (const os of ev.currentSections || []) if (!secsNew.has(skey(os))) out.push({ field: `Section “${os.name}”`, old: `removed: ${secSum(os)}`, new: '—' });
  for (const ns of prop.sections || []) {
    const os = secsOld.get(skey(ns));
    if (os && secSum(os) !== secSum(ns)) out.push({ field: `Section “${ns.name}”`, old: secSum(os), new: secSum(ns) });
  }

  return out;
};

function EditDiff({ ev }) {
  const { t } = useLang();
  const diff = buildDiffLines(ev, ev.proposedChanges, t);
  return (
    <details className="event-diff">
      <summary>{t('admin.viewChanges')} {diff.length ? `( ${diff.length} )` : ''}</summary>
      {diff.length === 0 ? (
        <p className="muted small">{t('admin.noFieldDiffs')}</p>
      ) : (
        <table className="diff-table">
          <thead><tr><th>{t('admin.diff.field')}</th><th>{t('admin.diff.before')}</th><th>{t('admin.diff.proposed')}</th></tr></thead>
          <tbody>
            {diff.map((d, i) => (
              <tr key={i}>
                <td>{d.field}</td>
                <td className="diff-old">{d.old}</td>
                <td className="diff-new">{d.new}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </details>
  );
}

const EMPTY_VOUCHER = {
  eventId: '',
  code: '',
  title: '',
  description: '',
  type: 'percent',
  value: '',
  maxDiscount: '',
  minSpend: '',
  usageLimit: '',
  perUserLimit: 1,
  expiresAt: '',
  active: true,
};

const EMPTY_REWARD = {
  name: '',
  description: '',
  image: '',
  pointsRequired: '',
  stock: '',
  value: '',
  category: 'merchandise',
  active: true,
};

const REWARD_CATEGORIES = ['merchandise', 'gift_card', 'upgrade'];
const CUSTOM_CATEGORY = '__custom__';

// `gift_card` is not just a label: the server keys isGiftCard and the required
// monetary `value` off that exact string, so the stored value must stay the slug
// even though the admin sees a friendly name.
const categoryOptionValue = (category) =>
  REWARD_CATEGORIES.includes(category) ? category : CUSTOM_CATEGORY;

export default function AdminPanel() {
  const { t } = useLang();
  const [tab, setTab] = useState('overview');
  const [stats, setStats] = useState(null);
  const [users, setUsers] = useState([]);
  const [queue, setQueue] = useState([]);
  const [refundQueue, setRefundQueue] = useState([]);
  const [fraud, setFraud] = useState(null);
  const [msg, setMsg] = useState('');
  const [vouchers, setVouchers] = useState([]);
  const [events, setEvents] = useState([]);
  const [vform, setVform] = useState({ ...EMPTY_VOUCHER });
  const [rewards, setRewards] = useState([]);
  const [rform, setRform] = useState({ ...EMPTY_REWARD });
  const [editingReward, setEditingReward] = useState(null);

  const loadAll = () => {
    api.get('/api/admin/stats').then(({ data }) => setStats(data)).catch(() => {});
    api.get('/api/admin/moderation').then(({ data }) => setQueue(data.events)).catch(() => {});
    api.get('/api/admin/refunds').then(({ data }) => setRefundQueue(data.refunds || [])).catch(() => {});
  };
  const loadUsers = () => api.get('/api/admin/users').then(({ data }) => setUsers(data.users)).catch(() => {});
  const loadFraud = () => api.get('/api/admin/fraud').then(({ data }) => setFraud(data)).catch(() => {});
  const loadVouchers = () => {
    api.get('/api/vouchers').then(({ data }) => setVouchers(data.vouchers)).catch(() => {});
    api.get('/api/events?limit=100').then(({ data }) => setEvents(data.events)).catch(() => {});
  };
  const loadRewards = () => api.get('/api/marketplace/admin/rewards').then(({ data }) => setRewards(data.rewards)).catch(() => {});

  useEffect(() => { loadAll(); }, []);
  useEffect(() => { if (tab === 'users') loadUsers(); if (tab === 'fraud') loadFraud(); if (tab === 'vouchers') loadVouchers(); if (tab === 'rewards') loadRewards(); }, [tab]);

  const act = async (fn, done) => { try { await fn(); if (done) setMsg(done); loadAll(); loadUsers(); loadFraud(); loadVouchers(); loadRewards(); } catch (e) { setMsg(e.message); } };
  const approveUser = (id, approve) => act(() => api.patch(`/api/admin/users/${id}`, { approve }), approve ? t('admin.organizerApproved') : t('admin.organizerRejected'));
  const banUser = (id, ban) => act(() => api.patch(`/api/admin/users/${id}`, { ban }), ban ? t('admin.userBanned') : t('admin.userUnbanned'));
  const reviewEvent = (id, decision) => act(() => api.post(`/api/admin/events/${id}/review`, { decision }), decision === 'approved' ? t('admin.eventApproved') : t('admin.eventRejected'));
  const reviewRefund = (id, decision) => act(() => api.patch(`/api/admin/refunds/${id}`, { decision }), decision === 'approved' ? t('admin.refundApproved') : t('admin.refundRejected'));

  const createVoucher = async (e) => {
    e.preventDefault();
    setMsg('');
    try {
      const payload = {
        eventId: vform.eventId,
        code: vform.code,
        title: vform.title,
        description: vform.description || undefined,
        type: vform.type,
        value: Number(vform.value),
        maxDiscount: vform.maxDiscount !== '' && vform.maxDiscount != null ? Number(vform.maxDiscount) : undefined,
        minSpend: vform.minSpend !== '' ? Number(vform.minSpend) : 0,
        usageLimit: vform.usageLimit !== '' ? Number(vform.usageLimit) : undefined,
        perUserLimit: Number(vform.perUserLimit) || 1,
        expiresAt: vform.expiresAt ? new Date(vform.expiresAt) : undefined,
        active: vform.active,
      };
      const { data } = await api.post('/api/vouchers', payload);
      setMsg(t('admin.vouchers.created', { code: data.voucher.code }));
      setVform({ ...EMPTY_VOUCHER });
      loadVouchers();
    } catch (err) { setMsg(err.message); }
  };

  const submitReward = async (e) => {
    e.preventDefault();
    setMsg('');
    try {
      const payload = {
        name: rform.name,
        description: rform.description || undefined,
        image: rform.image || undefined,
        pointsRequired: Number(rform.pointsRequired),
        stock: rform.stock !== '' ? Number(rform.stock) : 0,
        value: rform.value !== '' ? Number(rform.value) : undefined,
        category: rform.category,
        active: rform.active,
      };
      if (editingReward) {
        await api.patch(`/api/marketplace/admin/rewards/${editingReward._id}`, payload);
        setMsg(t('admin.rewards.updated'));
      } else {
        await api.post('/api/marketplace/admin/rewards', payload);
        setMsg(t('admin.rewards.created'));
      }
      setRform({ ...EMPTY_REWARD });
      setEditingReward(null);
      loadRewards();
    } catch (err) { setMsg(err.message); }
  };

  const editReward = (r) => {
    setEditingReward(r);
    setRform({
      name: r.name || '',
      description: r.description || '',
      image: r.image || '',
      pointsRequired: String(r.pointsRequired ?? ''),
      stock: String(r.stock ?? ''),
      value: r.value != null ? String(r.value) : '',
      category: r.category || 'merchandise',
      active: r.active !== false,
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const deleteReward = async (r) => {
    if (!window.confirm(t('admin.rewards.deleteConfirm', { name: r.name }))) return;
    try {
      await api.del(`/api/marketplace/admin/rewards/${r._id}`);
      setMsg(t('admin.rewards.deleted'));
      if (editingReward?._id === r._id) { setEditingReward(null); setRform({ ...EMPTY_REWARD }); }
      loadRewards();
    } catch (err) { setMsg(err.message); }
  };

  return (
    <div className="container">
      <div className="acct-head">
        <div>
          <h1>{t('admin.title')}</h1>
          {stats && <p className="muted">{t('admin.statsLine', { users: stats.users, events: stats.events, tickets: stats.ticketsSold, revenue: stats.revenue.toLocaleString() })}</p>}
        </div>
        <div className="row-gap">
          <Link className="btn btn-ghost" to="/account#profile">{t('admin.changePassword')}</Link>
        </div>
      </div>

      {msg && <div className="alert alert-info" onClick={() => setMsg('')}>{msg}</div>}

      <nav className="tabs" aria-label="Admin sections">
        {Tabs.map((t2) => <button key={t2} className={`tab ${tab === t2 ? 'active' : ''}`} onClick={() => setTab(t2)}>{t(`admin.tabs.${t2}`)}</button>)}
      </nav>

      {tab === 'overview' && (
        <div className="stat-row">
          <div className="stat"><strong>{stats?.users ?? '—'}</strong><span>{t('admin.users')}</span></div>
          <div className="stat"><strong>{stats?.events ?? '—'}</strong><span>{t('admin.events')}</span></div>
          <div className="stat"><strong>{stats?.ticketsSold ?? '—'}</strong><span>{t('admin.ticketsSold')}</span></div>
          <div className="stat"><strong>${stats?.revenue?.toLocaleString() ?? '—'}</strong><span>{t('admin.revenue')}</span></div>
          <div className="stat"><strong>{stats?.resaleSold ?? '—'}</strong><span>{t('admin.resaleSold')}</span></div>
          <div className="stat"><strong>{stats?.refundRequests ?? '—'}</strong><span>{t('admin.refundsPending')}</span></div>
        </div>
      )}

      {tab === 'users' && (
        <section className="card-list">
          {users.map((u) => (
            <div className="card row-card" key={u.id}>
              <div className="row-card-main">
                <h3>{u.name} <span className={`pill pill-${u.role}`}>{u.role}</span> {u.isBanned && <span className="badge">BANNED</span>}</h3>
                <p className="muted">{u.email}{u.organization ? ` · ${u.organization}` : ''}{u.isApproved !== undefined && u.role === 'organizer' ? ` · approved: ${u.isApproved ? 'yes' : 'no'}` : ''}</p>
              </div>
              <div className="row-card-side">
                {u.role === 'organizer' && !u.isApproved && <button className="btn btn-dark btn-sm" onClick={() => approveUser(u.id, true)}>{t('admin.approve')}</button>}
                {u.role === 'organizer' && u.isApproved && <button className="btn btn-ghost btn-sm" onClick={() => approveUser(u.id, false)}>{t('admin.revoke')}</button>}
                <button className="btn btn-ghost btn-sm danger-text" onClick={() => banUser(u.id, !u.isBanned)}>{u.isBanned ? t('admin.unban') : t('admin.ban')}</button>
              </div>
            </div>
          ))}
        </section>
      )}

      {tab === 'moderation' && (
        <section className="card-list">
          {queue.length === 0 && <p className="muted">{t('admin.nothingWaiting')}</p>}
          {queue.map((e) => (
            <div className="card row-card" key={e.id}>
              <div className="row-card-main">
                <h3>{e.title} {e.isEdit && <span className="pill pill-edit">{t('admin.editRequest')}</span>}</h3>
                <p className="muted">{e.category} · 📅 {formatDateRange(e.startDate, e.endDate)} · 📍 {e.venue?.city} · by {e.owner?.name} ({e.owner?.organization || 'independent'})</p>
                <span className={`pill st-${e.isEdit ? 'pending' : e.approval}`}>{e.isEdit ? t('admin.pendingEdit') : e.approval}</span>
                {e.isEdit && <EditDiff ev={e} />}
              </div>
              <div className="row-card-side">
                <a className="btn btn-ghost btn-sm" href={`/events/${e.slug}`}>{t('admin.view')}</a>
                <button className="btn btn-dark btn-sm" onClick={() => reviewEvent(e.id, 'approved')}>{t('admin.approve')}</button>
                <button className="btn btn-ghost btn-sm" onClick={() => reviewEvent(e.id, 'rejected')}>{t('admin.reject')}</button>
              </div>
            </div>
          ))}
        </section>
      )}

      {tab === 'refunds' && (
        <section className="card-list">
          {refundQueue.length === 0 && <p className="muted">{t('admin.noActiveRefunds')}</p>}
          {refundQueue.map((b) => (
            <div className="card row-card" key={b._id}>
              <div className="row-card-main">
                <h3>{b.event?.title || 'Booking refund'}</h3>
                <p className="muted">{t('admin.refundLine', { ref: b.reference, name: b.user?.name, email: b.user?.email, items: b.items.map((i) => `${i.categoryName}×${i.qty}`).join(', '), total: b.total })}</p>
                <span className="pill st-refund_pending">refund_pending</span>
                {b.refundBlocked && (
                  // The API refuses this too; saying so up front saves the admin
                  // discovering it through an error after clicking Approve.
                  <p className="alert alert-error refund-blocked">
                    {t('admin.refundBlocked', {
                      n: b.refundBlockers.length,
                      reasons: [...new Set(b.refundBlockers.map((x) => x.reason))].join(' and '),
                    })}
                  </p>
                )}
              </div>
              <div className="row-card-side">
                <button
                  className="btn btn-dark btn-sm"
                  disabled={b.refundBlocked}
                  title={b.refundBlocked ? t('admin.refundBlockedTitle') : undefined}
                  onClick={() => reviewRefund(b._id, 'approved')}
                >
                  {t('admin.approve')}
                </button>
                <button className="btn btn-ghost btn-sm" onClick={() => reviewRefund(b._id, 'rejected')}>{t('admin.reject')}</button>
              </div>
            </div>
          ))}
        </section>
      )}

      {tab === 'fraud' && (
        <section>
          <h2>{t('admin.fraudMonitor')}</h2>
          {!fraud && <p className="muted">{t('admin.loading')}</p>}
          {fraud && (
            <>
              <div className="card">
                <h3>{t('admin.flaggedCustomers')}</h3>
                {fraud.flaggedUsers.length === 0 && <p className="muted">{t('admin.noSuspicious')}</p>}
                {fraud.flaggedUsers.map((f) => (
                  <div className="fraud-user" key={f.user._id}>
                    <div className="row-line">
                      <strong>{f.user.name} ({f.user.email})</strong>
                      <span className="muted">{t('admin.cancellationsRate', { n: f.cancellations, rate: f.cancelRate })}</span>
                    </div>
                    {f.actions && f.actions.length > 0 && (
                      <ul className="fraud-actions">{t('admin.fraudActionsTitle') && <li className="fraud-actions-title">{t('admin.fraudActionsTitle')}</li>}
                        {f.actions.map((a, i) => (
                          <li key={`${a.reference}-${i}`}>
                            <span>{a.status}</span>
                            {a.eventTitle ? ` ${a.eventTitle} ` : ' '}({a.reference}){a.cancelReason ? ` — ${a.cancelReason}` : ''}
                            <span className="muted small">{new Date(a.at).toLocaleString()}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
              <div className="card">
                <h3>{t('admin.priceGouging')}</h3>
                {fraud.priceGouging.length === 0 && <p className="muted">{t('admin.noGouging')}</p>}
                {fraud.priceGouging.map((g) => (
                  <div className="row-line" key={g._id}>
                    <span>{t('admin.gougingLine', { price: g.price, face: g.faceValue })}{g.sellerName ? ` — ${g.sellerName} (${g.sellerEmail})` : ''}</span>
                    <span className="muted">{g.status}{g.listedAt ? ` · ${new Date(g.listedAt).toLocaleString()}` : ''}</span>
                  </div>
                ))}
              </div>
              <div className="card">
                <h3>{t('admin.summary')}</h3>
                <p className="muted">{t('admin.summaryLine', { cancel: fraud.summary.cancelled7d, risky: fraud.summary.riskyUsers, qr: fraud.invalidQrAttempts })}</p>
              </div>
            </>
          )}
        </section>
      )}

      {tab === 'rewards' && (
        <section className="card-list">
          <div className="card">
            <h2>{editingReward ? t('admin.rewards.editTitle') : t('admin.rewards.title')}</h2>
            <p className="muted">{t('admin.rewards.intro')}</p>
            <form onSubmit={submitReward}>
              <label>{t('admin.rewards.name')}
                <input required value={rform.name} onChange={(e) => setRform({ ...rform, name: e.target.value })} placeholder={t('admin.rewards.namePlaceholder')} />
              </label>
              <label>{t('admin.rewards.description')}
                <textarea rows="2" value={rform.description} onChange={(e) => setRform({ ...rform, description: e.target.value })} />
              </label>
              <label>{t('admin.rewards.image')}
                <input type="url" value={rform.image} onChange={(e) => setRform({ ...rform, image: e.target.value })} placeholder="https://…" />
              </label>
              <div className="grid2">
                <label>{t('admin.rewards.pointsRequired')}
                  <input required type="number" min="1" value={rform.pointsRequired} onChange={(e) => setRform({ ...rform, pointsRequired: e.target.value })} />
                </label>
                <label>{t('admin.rewards.stock')}
                  <input type="number" min="0" value={rform.stock} onChange={(e) => setRform({ ...rform, stock: e.target.value })} placeholder="0" />
                </label>
              </div>
              <div className="grid2">
                <label>{t('admin.rewards.category')}
                  <select
                    value={categoryOptionValue(rform.category)}
                    onChange={(e) => {
                      const next = e.target.value;
                      setRform({
                        ...rform,
                        category: next === CUSTOM_CATEGORY ? '' : next,
                      });
                    }}
                  >
                    {REWARD_CATEGORIES.map((c) => (
                      <option key={c} value={c}>{t(`admin.rewards.categories.${c}`)}</option>
                    ))}
                    <option value={CUSTOM_CATEGORY}>{t('admin.rewards.categoryOther')}</option>
                  </select>
                </label>
                {categoryOptionValue(rform.category) === CUSTOM_CATEGORY && (
                  <label>{t('admin.rewards.categoryCustom')}
                    <input
                      value={rform.category}
                      onChange={(e) => setRform({ ...rform, category: e.target.value.replace(/\s+/g, '_').toLowerCase() })}
                      placeholder="my_category"
                    />
                  </label>
                )}
                {REWARD_CATEGORIES.includes(rform.category) && (
                  <p className="muted smaller form-hint">{t('admin.rewards.categoryStored', { value: rform.category })}</p>
                )}
                {rform.category === 'gift_card' && (
                  <label>{t('admin.rewards.value')}
                    <input required type="number" min="1" step="0.01" value={rform.value} onChange={(e) => setRform({ ...rform, value: e.target.value })} placeholder="10" />
                  </label>
                )}
                <label className="switch-row" style={{ alignSelf: 'end' }}>
                  <input type="checkbox" checked={rform.active} onChange={(e) => setRform({ ...rform, active: e.target.checked })} />
                  <span>{t('admin.rewards.active')}</span>
                </label>
              </div>
              <div className="row-gap">
                <button className="btn btn-dark" type="submit">{editingReward ? t('admin.rewards.saveChanges') : t('admin.rewards.create')}</button>
                {editingReward && <button type="button" className="btn btn-ghost" onClick={() => { setEditingReward(null); setRform({ ...EMPTY_REWARD }); }}>{t('common.cancel')}</button>}
              </div>
            </form>
          </div>

          <h3>{t('admin.rewards.listTitle')}</h3>
          {rewards.length === 0 && <p className="muted">{t('admin.rewards.none')}</p>}
          {rewards.map((r) => (
            <div className="card row-card" key={r._id}>
              <div className="row-card-main">
                <h3>{r.name} <span className={`pill ${r.active ? 'st-active' : 'pill-pending'}`}>{r.active ? t('admin.rewards.active') : t('admin.rewards.inactive')}</span></h3>
                {r.description && <p className="muted small">{r.description}</p>}
                <p className="muted small">
                  {r.pointsRequired} pts · {t('admin.rewards.stockLine', { stock: r.stock, redeemed: r.redeemedCount || 0 })}
                  {r.category === 'gift_card' && ` · ${t('admin.rewards.worth', { value: r.value ?? 0 })}`}
                  {r.image && <span className="muted"> · <a href={r.image} target="_blank" rel="noreferrer">img</a></span>}
                </p>
              </div>
              <div className="row-card-side">
                <button className="btn btn-ghost btn-sm" onClick={() => editReward(r)}>{t('common.edit')}</button>
                <button className="btn btn-ghost btn-sm danger-text" onClick={() => deleteReward(r)}>{t('common.delete')}</button>
              </div>
            </div>
          ))}
        </section>
      )}

      {tab === 'vouchers' && (
        <section className="card-list">
          <div className="card">
            <h2>{t('admin.vouchers.title')}</h2>
            <p className="muted">{t('admin.vouchers.intro')}</p>
            <form onSubmit={createVoucher}>
              <label>{t('admin.vouchers.event')}
                <select required value={vform.eventId} onChange={(e) => setVform({ ...vform, eventId: e.target.value })}>
                  <option value="">{t('admin.vouchers.selectEvent')}</option>
                  {events.map((ev) => <option key={ev.id} value={ev.id}>{ev.title}</option>)}
                </select>
              </label>
              <div className="grid2">
                <label>{t('admin.vouchers.code')}
                  <input required value={vform.code} onChange={(e) => setVform({ ...vform, code: e.target.value })} placeholder={t('admin.vouchers.codePlaceholder')} />
                </label>
                <label>{t('admin.vouchers.titleField')}
                  <input required value={vform.title} onChange={(e) => setVform({ ...vform, title: e.target.value })} placeholder={t('admin.vouchers.titlePlaceholder')} />
                </label>
              </div>
              <label>{t('admin.vouchers.description')}
                <textarea rows="2" value={vform.description} onChange={(e) => setVform({ ...vform, description: e.target.value })} />
              </label>
              <div className="grid2">
                <label>{t('admin.vouchers.type')}
                  <select value={vform.type} onChange={(e) => setVform({ ...vform, type: e.target.value })}>
                    <option value="percent">{t('admin.vouchers.typePercent')}</option>
                    <option value="fixed">{t('admin.vouchers.typeFixed')}</option>
                  </select>
                </label>
                <label>{t('admin.vouchers.value')}
                  <input required type="number" min="0" step="0.5" value={vform.value} onChange={(e) => setVform({ ...vform, value: e.target.value })} />
                </label>
              </div>
              <div className="grid2">
                <label>{t('admin.vouchers.maxDiscount')}
                  <input type="number" min="0" step="0.5" value={vform.maxDiscount} onChange={(e) => setVform({ ...vform, maxDiscount: e.target.value })} />
                </label>
                <label>{t('admin.vouchers.minSpend')}
                  <input type="number" min="0" step="0.5" value={vform.minSpend} onChange={(e) => setVform({ ...vform, minSpend: e.target.value })} />
                </label>
              </div>
              <div className="grid2">
                <label>{t('admin.vouchers.usageLimit')}
                  <input type="number" min="1" value={vform.usageLimit} onChange={(e) => setVform({ ...vform, usageLimit: e.target.value })} placeholder="∞" />
                </label>
                <label>{t('admin.vouchers.perUserLimit')}
                  <input type="number" min="1" value={vform.perUserLimit} onChange={(e) => setVform({ ...vform, perUserLimit: e.target.value })} />
                </label>
              </div>
              <label>{t('admin.vouchers.expiresAt')}
                <input type="datetime-local" value={vform.expiresAt} onChange={(e) => setVform({ ...vform, expiresAt: e.target.value })} />
              </label>
              <label className="switch-row">
                <input type="checkbox" checked={vform.active} onChange={(e) => setVform({ ...vform, active: e.target.checked })} />
                <span>{t('admin.vouchers.active')}</span>
              </label>
              <button className="btn btn-dark" type="submit">{t('admin.vouchers.create')}</button>
            </form>
          </div>

          <h3>{t('admin.vouchers.listTitle')}</h3>
          {vouchers.length === 0 && <p className="muted">{t('admin.vouchers.none')}</p>}
          {vouchers.map((v) => (
            <div className="card row-card" key={v._id}>
              <div className="row-card-main">
                <h3>{v.title} <span className={`pill ${v.active ? 'st-active' : 'pill-pending'}`}>{v.active ? 'active' : 'inactive'}</span></h3>
                <p className="muted"><code>{v.code}</code> · {v.type === 'percent' ? `${v.value}% off` : `$${v.value} off`}{v.event ? ` · event: ${v.event.title}` : ''}</p>
                <p className="muted small">
                  {v.expiresAt ? `${t('admin.vouchers.validUntil', { date: formatDateRange(v.expiresAt, null) })} · ` : ''}
                  {v.usageLimit
                    ? t('admin.vouchers.usedCount', { used: v.usedCount, limit: v.usageLimit })
                    : t('admin.vouchers.unlimited')}
                </p>
              </div>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}