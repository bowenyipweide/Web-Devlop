import React from 'react';
import { Link } from 'react-router-dom';
import { useLang } from '../i18n/LanguageContext.jsx';

export const formatDate = (d) => {
  const date = new Date(d);
  return date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }) +
    ' · ' + date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
};

export const formatDateRange = (start, end) => {
  const s = new Date(start);
  const e = end ? new Date(end) : null;

  const sameDay =
    e && s.getDate() === e.getDate() && s.getMonth() === e.getMonth() && s.getFullYear() === e.getFullYear();
  if (!e || sameDay) return formatDate(start);

  const sameMonth = s.getMonth() === e.getMonth() && s.getFullYear() === e.getFullYear();
  const sameYear = s.getFullYear() === e.getFullYear();

  const fmt = (d, opts) => d.toLocaleDateString(undefined, opts);
  const day = { day: 'numeric' };
  const monthShort = { month: 'short' };
  const monthDay = { month: 'short', day: 'numeric' };
  const full = { month: 'short', day: 'numeric', year: 'numeric' };

  let range;
  if (sameMonth) {
    range = `${fmt(s, day)}–${fmt(e, monthDay)}`;
  } else if (sameYear) {
    range = `${fmt(s, monthDay)} – ${fmt(e, monthDay)}`;
  } else {
    range = `${fmt(s, full)} – ${fmt(e, full)}`;
  }

  const time = s.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return `${range} · ${time}`;
};

export const fromPrice = (event) =>
  event.ticketCategories?.length ? Math.min(...event.ticketCategories.map((c) => c.price)) : 0;

export const CATEGORY_LABELS = {
  concert: '🎤 Concert',
  theatre: '🎭 Theatre',
  sports: '🏆 Sports',
  cultural: '🏛 Cultural',
  festival: '🎪 Festival',
  other: '✨ Other',
};

export default function EventCard({ event }) {
  const { lang, t } = useLang();
  const label = lang === 'zh' ? t(`eventCard.category.${event.category}`) : CATEGORY_LABELS[event.category] || event.category;
  return (
    <Link to={`/events/${event.slug}`} className="event-card" aria-label={t('eventCard.detailsAria', { title: event.title })}>
      <div className="event-card-img">
        <img src={event.image || 'https://images.unsplash.com/photo-1492684223066-81342ee5ff30?w=800&q=70'} alt="" loading="lazy" />
        <span className="event-cat">{label}</span>
      </div>
      <div className="event-card-body">
        <h3>{event.title}</h3>
        <p className="muted row-gap">
          <span>📅 {formatDateRange(event.startDate, event.endDate)}</span>
          <span>📍 {event.venue?.city}</span>
        </p>
        <div className="event-card-foot">
          <span className="price">{t('eventCard.fromPrice', { price: fromPrice(event) })}</span>
          <span className="btn btn-dark btn-sm js-none">{t('eventCard.getTickets')}</span>
        </div>
      </div>
    </Link>
  );
}