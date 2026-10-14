import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import { useLang } from '../i18n/LanguageContext.jsx';
import TermsConsent from './TermsConsent.jsx';

const getFallbackReply = (dict, input) => {
  const q = input.toLowerCase();
  const text = q.replace(/[^a-z0-9\u4e00-\u9fff\s]/g, ' ').replace(/\s+/g, ' ').trim();
  for (const f of dict.chatbot.faqs || []) {
    if (f.k.some((k) => text.includes(k))) return f.a;
  }
  return dict.chatbot.fallbackError || 'Assistant unavailable. Please try again.';
};

const renderMessage = (text) => {
  const parts = String(text || '').split('\n');
  return parts.map((p, i) => (
    <div key={i} className="chat-msg-line">
      {p.split(/\*\*([^*]+)\*\*/g).map((seg, j) => (j % 2 === 1 ? <strong key={j}>{seg}</strong> : seg))}
    </div>
  ));
};

const money = (n) => (n == null ? '' : `$${n}`);

const SEAT_STATUS_CLASS = {
  available: 'seat-available',
  held: 'seat-held',
  booked: 'seat-booked',
  selected: 'seat-selected',
};

function ChoiceBubble({ bubble, disabled, onPick }) {
  return (
    <div className="chat-choices">
      {bubble.header && <div className="chat-bubble-header">{bubble.header}</div>}
      {bubble.options.map((o) => (
        <button
          key={o.id}
          className="chat-choice-btn"
          disabled={disabled || o.disabled}
          onClick={() => onPick(o, bubble.context)}
        >
          <span className="chat-choice-label">{o.label}</span>
          {o.sub && <span className="chat-choice-sub">{o.sub}</span>}
        </button>
      ))}
    </div>
  );
}

function SeatsBubble({ bubble, disabled, onConfirm }) {
  const { t } = useLang();
  const [selected, setSelected] = useState([]);

  const grouped = useMemo(() => {
    const map = new Map();
    (bubble.seats || []).forEach((s) => {
      if (!map.has(s.section)) map.set(s.section, []);
      map.get(s.section).push(s);
    });
    return [...map.entries()].map(([section, list]) => ({
      section,
      rows: [...new Set(list.map((s) => s.row))].sort().map((row) => ({
        row,
        seats: list.filter((s) => s.row === row).sort((a, b) => a.number - b.number),
      })),
    }));
  }, [bubble.seats]);

  useEffect(() => {
    setSelected([]);
  }, [bubble.seats && bubble.seats.length, bubble.eventId, bubble.sessionId]);

  const toggle = (seat) => {
    if (seat.status !== 'available') return;
    if (selected.some((s) => s._id === seat._id)) {
      setSelected(selected.filter((s) => s._id !== seat._id));
      return;
    }
    if (selected.length >= bubble.qty) return;
    setSelected((prev) => [...prev, seat]);
  };

  const done = selected.length === bubble.qty;
  const remaining = Math.max(0, bubble.qty - selected.length);

  return (
    <div className="chat-seatmap">
      <div className="chat-seatmap-stage" role="img" aria-label="Stage">{t('chatbot.stage')}</div>
      <div className="chat-seatmap-scroll">
        {grouped.map(({ section, rows }) => (
          <div key={section} className="chat-seat-section">
            <div className="chat-seat-section-title">{section}</div>
            {rows.map(({ row, seats }) => (
              <div className="seat-row" key={row}>
                <span className="chat-row-label">{row}</span>
                {seats.map((s) => {
                  const isSel = selected.some((x) => x._id === s._id);
                  const status = isSel ? 'selected' : s.status;
                  return (
                    <button
                      key={s._id}
                      type="button"
                      className={`seat ${SEAT_STATUS_CLASS[status] || 'seat-available'}`}
                      disabled={s.status === 'held' || s.status === 'booked'}
                      onClick={() => toggle(s)}
                      title={`${s.section} ${s.row}${s.number}`}
                      aria-label={`${s.section} ${s.row}${s.number} ${status}`}
                    >
                      {s.number}
                    </button>
                  );
                })}
                <span className="chat-row-label">{row}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className="chat-seat-summary">
        {selected.length
          ? t('chatbot.selectedCount', { n: selected.length, q: bubble.qty })
          : t('chatbot.pickSeats', { n: bubble.qty })}
      </div>
      <button
        type="button"
        className="btn btn-dark btn-sm chat-confirm-seats"
        disabled={disabled || !done}
        onClick={() => onConfirm(selected.map((s) => s._id), bubble)}
      >
        {done ? t('chatbot.confirmSeats', { label: bubble.qty > 1 ? t('chatbot.seatLabel') : t('chatbot.seatSingle') }) : remaining > 0 ? t('chatbot.selectMore', { n: remaining }) : t('chatbot.tapSeat')}
      </button>
    </div>
  );
}

// Same picker as the checkout page: a compact trigger that opens a one-line
// multi-select list, so stacking a voucher with a gift card works in chat too.
function DiscountsBubble({ bubble, disabled, onChange, t }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  // Held locally rather than read straight off the prop. The server re-quotes on
  // every toggle, and reading `bubble.selected` meant an in-flight response landed
  // on top of the click the customer had just made — so ticking stuck on and
  // unticking snapped straight back.
  const [selected, setSelected] = useState(() => (bubble.selected || []).map(String));
  useEffect(() => {
    const incoming = (bubble.selected || []).map(String);
    setSelected((prev) => {
      const unchanged = prev.length === incoming.length && prev.every((v, i) => v === incoming[i]);
      return unchanged ? prev : incoming;
    });
  }, [bubble.selected]);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const total = bubble.offers
    .filter((o) => selected.includes(String(o.id)))
    .reduce((s, o) => s + Number(o.discount || 0), 0);

  // Purely local. Sending on every tick appended a fresh "Shall I book this?"
  // message each time, which scrolled the open picker away and read as the list
  // closing itself — and left no way to untick anything.
  const toggle = (id) => {
    const key = String(id);
    setSelected((prev) => (prev.includes(key) ? prev.filter((x) => x !== key) : [...prev, key]));
  };

  return (
    <div className="offer-dropdown chat-offers" ref={ref}>
      {bubble.header && <div className="chat-bubble-header">{bubble.header}</div>}
      <button
        type="button"
        className="offer-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
      >
        {/* Live projection from local state: the confirmed price only catches up
            once the picker is applied. */}
        <span className="offer-trigger-label">
          {selected.length
            ? (selected.length === 1
              ? t('chatbot.pickerOne')
              : t('chatbot.pickerMany', { n: selected.length }))
            : t('chatbot.pickerEmpty')}
        </span>
        {total > 0 && <span className="offer-trigger-total">-{money(total)}</span>}
        <span className="offer-trigger-chevron" aria-hidden="true">▾</span>
      </button>

      {open && (
        <div className="offer-menu" role="listbox" aria-multiselectable="true" aria-label={bubble.header}>
          <p className="offer-menu-note">{t('chatbot.pickerHint')}</p>
          {bubble.offers.map((o) => {
            const key = String(o.id);
            const on = selected.includes(key);
            return (
              <label className={`offer-row${on ? ' on' : ''}`} key={key}>
                <input type="checkbox" checked={on} disabled={disabled} onChange={() => toggle(key)} />
                <span className="offer-label">
                  <span className="offer-title">{o.title || o.code}</span>
                  <span className="offer-meta">
                    {o.isGiftCard ? t('chatbot.giftCard') : (o.event?.title || t('chatbot.thisEvent'))}
                  </span>
                </span>
                <span className="offer-pill">-{money(o.discount)}</span>
              </label>
            );
          })}
          <div className="offer-actions">
            <button
              type="button"
              className="offer-clear"
              disabled={disabled || !selected.length}
              onClick={() => setSelected([])}
            >
              {t('chatbot.pickerClear')}
            </button>
            <button
              type="button"
              className="btn btn-dark btn-sm"
              disabled={disabled}
              onClick={() => {
                // One round trip, on apply, so the price updates once.
                onChange(selected);
                setOpen(false);
              }}
            >
              {t('chatbot.pickerApply')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function PaymentBubble({ bubble, onPaid }) {
  const { t } = useLang();
  const [status, setStatus] = useState('idle');
  const [err, setErr] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [termsSignal, setTermsSignal] = useState(0);

  const pay = async (provider) => {
    if (!agreed) {
      setTermsSignal((s) => s + 1);
      return;
    }
    setStatus('paying');
    setErr('');
    try {
      await api.post('/api/payments/pay', { bookingId: bubble.bookingId, provider });
      setStatus('paid');
      if (onPaid) onPaid(bubble);
    } catch (e) {
      setErr(e.message || t('chatbot.paymentFailed'));
      setStatus('error');
    }
  };

  return (
    <div className="chat-payment">
      <div className="chat-payment-head">{t('chatbot.paySecurely', { ref: bubble.reference })}</div>
      <div className="chat-payment-row"><span>{t('chatbot.event')}</span><strong>{bubble.eventTitle}</strong></div>
      {bubble.detail && <div className="chat-payment-row"><span>{t('chatbot.details')}</span><span>{bubble.detail}</span></div>}
      <div className="chat-payment-total">{t('chatbot.total')} <strong>{money(bubble.total)}</strong></div>

      {status === 'paid' ? (
        <div className="chat-paid">
          <div className="chat-paid-title">{t('chatbot.paymentSuccessful')}</div>
          <p className="chat-paid-note">{t('chatbot.paymentNote', { ref: bubble.reference })}</p>
          <Link className="btn btn-dark btn-sm" to="/account#tickets">{t('chatbot.viewMyETickets')}</Link>
        </div>
      ) : (
        <>
          <TermsConsent checked={agreed} onChange={setAgreed} kind="checkout" openSignal={termsSignal} />
          <button type="button" className="btn btn-dark btn-sm chat-pay-btn" disabled={status === 'paying'} onClick={() => pay('simulated')}>
            {status === 'paying' ? t('chatbot.processing') : t('chatbot.payNow', { total: bubble.total })}
          </button>
          <button type="button" className="btn btn-sm chat-pay-btn-alt" disabled={status === 'paying'} onClick={() => pay('paynow')}>
            {t('chatbot.payWithPaynow')}
          </button>
          <Link to={`/checkout/${bubble.bookingId}`} className="chat-link">{t('chatbot.openCheckout')}</Link>
          <p className="muted small">{t('chatbot.seatsHeld')}</p>
          {status === 'error' && <div className="alert alert-error">{err}</div>}
        </>
      )}
    </div>
  );
}

export default function Chatbot() {
  const navigate = useNavigate();
  const { lang, t, dict } = useLang();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([{ from: 'bot', text: dict.chatbot.greeting, link: null, bubble: null }]);
  const [input, setInput] = useState('');
  const [typing, setTyping] = useState(false);
  const bodyRef = useRef(null);
  const [sessionId] = useState(() =>
    typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : String(Date.now())
  );

  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [messages, typing, open]);

  const addBot = (text, link, bubble) => setMessages((m) => [...m, { from: 'bot', text, link: link || null, bubble: bubble || null }]);

  const send = async (e, preset) => {
    e && e.preventDefault();
    let text = preset !== undefined ? preset : input.trim();
    let action = null;
    if (preset && typeof preset === 'object') {
      text = preset.text || '';
      action = preset.action || null;
    }
    if (!text && !action) return;
    setMessages((m) => [...m, { from: 'user', text, link: null, bubble: null }]);
    setInput('');
    setTyping(true);
    try {
      const res = await api.post('/api/chat', { message: text, sessionId, ...(action ? { action } : {}) });
      const reply = res?.reply || getFallbackReply(dict, text);
      addBot(reply, res?.link, res?.bubble);
    } catch (err) {
      addBot(getFallbackReply(dict, text), null, null);
    } finally {
      setTyping(false);
    }
  };

  const pickChoice = (option, context) => {
    if (context === 'login') {
      navigate('/login');
      addBot(t('chatbot.goLogin'), '/login', null);
      return;
    }
    send(null, { text: option.label || option.id, action: { type: 'choose', context, id: option.id } });
  };

  const confirmSeats = (seatIds, bubble) => {
    const seats = (bubble.seats || []).filter((s) => seatIds.includes(s._id));
    const label = seats.map((s) => `${s.section} ${s.row}${s.number}`).join(', ');
    send(null, {
      text: label || t('chatbot.confirmSeatsLabel'),
      action: { type: 'seats', seatIds, eventId: bubble.eventId, sessionId: bubble.sessionId },
    });
  };

  const onPaid = (bubble) => {
    addBot(t('chatbot.onPaidNote', { ref: bubble.reference }));
  };

  const pickDiscounts = (selected) => {
    send(null, {
      text: selected.length
        ? t('chatbot.pickRewardsLabel', { n: selected.length })
        : t('chatbot.pickNoRewards'),
      action: { type: 'discounts', selected },
    });
  };

  // A group bubble lets the summary carry the reward picker and the confirm
  // buttons together, so both render inside the same chat message.
  const renderBubbles = (bubble, key = 'b') => {
    if (!bubble) return null;
    if (bubble.type === 'group') {
      return (bubble.children || []).map((child, i) => (
        <React.Fragment key={`${key}-${i}`}>{renderBubbles(child, `${key}-${i}`)}</React.Fragment>
      ));
    }
    if (bubble.type === 'discounts') {
      return <DiscountsBubble key={key} bubble={bubble} disabled={typing} onChange={pickDiscounts} t={t} />;
    }
    if (bubble.type === 'choices') return <ChoiceBubble key={key} bubble={bubble} disabled={typing} onPick={pickChoice} />;
    if (bubble.type === 'seats') return <SeatsBubble key={key} bubble={bubble} disabled={typing} onConfirm={confirmSeats} />;
    if (bubble.type === 'payment') return <PaymentBubble key={key} bubble={bubble} onPaid={onPaid} />;
    return null;
  };

  return (
    <div className="chatbot">
      {open && (
        <div className="chatbot-window" role="dialog" aria-label={t('chatbot.title')}>
          <div className="chatbot-head">
            <strong>{t('chatbot.title')}</strong>
            <button className="chatbot-close" aria-label={t('chatbot.close')} onClick={() => setOpen(false)}>×</button>
          </div>
          <div className="chatbot-body" ref={bodyRef}>
            {messages.map((m, i) => (
              <div key={i} className={`chat-msg ${m.from === 'user' ? 'me' : ''}`}>
                {renderMessage(m.text)}
                {renderBubbles(m.bubble, `m${i}`)}
                {m.link && m.bubble?.type !== 'payment' && (
                  <Link to={m.link} className="chat-link" onClick={() => setOpen(false)}>{t('chatbot.openEvent')}</Link>
                )}
              </div>
            ))}
            {typing && <div className="chat-msg bot chat-typing">…</div>}
            {messages.length <= 1 && (
              <div className="chat-sugg">
                {(dict.chatbot.suggestions || []).map((s) => (
                  <button key={s} className="chat-chip" onClick={() => send(null, s)}>{s}</button>
                ))}
              </div>
            )}
          </div>
          <form className="chatbot-form" onSubmit={send}>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={t('chatbot.placeholder')}
              aria-label={t('chatbot.placeholder')}
            />
            <button className="btn btn-dark btn-sm" type="submit" disabled={typing}>{t('chatbot.send')}</button>
          </form>
        </div>
      )}
      <button
        className="chatbot-launcher"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={t('chatbot.launcher')}
      >
        {open ? '✕' : '💬'}
        {!open && <span className="chatbot-badge">{t('chatbot.help')}</span>}
      </button>
    </div>
  );
}