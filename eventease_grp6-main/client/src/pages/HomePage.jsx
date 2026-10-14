import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useLang } from '../i18n/LanguageContext.jsx';
import { api, qs } from '../api/client.js';
import EventCard, { CATEGORY_LABELS } from '../components/EventCard.jsx';

const CATEGORIES = ['', 'concert', 'theatre', 'sports', 'cultural', 'festival'];

export default function HomePage() {
  const { lang, t } = useLang();
  const [params, setParams] = useSearchParams();
  const [events, setEvents] = useState([]);
  const [cities, setCities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [meta, setMeta] = useState({ total: 0, pages: 1, page: 1 });

  const q = params.get('q') || '';
  const category = params.get('category') || '';
  const city = params.get('city') || '';
  const dateFrom = params.get('dateFrom') || '';
  const priceMax = params.get('priceMax') || '';
  const sort = params.get('sort') || 'upcoming';
  const page = params.get('page') || 1;

  const setParam = (key, value) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== 'page') next.delete('page');
    setParams(next);
  };

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    api.get(`/api/events${qs({ q, category, city, dateFrom, priceMax, sort, page, limit: 12 })}`)
      .then(({ data }) => {
        if (!alive) return;
        setEvents(data.events);
        setCities(data.cities || []);
        setMeta({ total: data.total, pages: data.pages, page: data.page });
      })
      .catch((e) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [q, category, city, dateFrom, priceMax, sort, page]);

  const catLabel = (c) => (c ? (lang === 'zh' ? t(`eventCard.category.${c}`) : CATEGORY_LABELS[c]) : t('home.all'));

  return (
    <div>
      <section className="hero">
        <div className="container hero-inner">
          <h1>{t('home.heroTitle')}</h1>
          <p className="hero-sub">{t('home.heroSub')}</p>
          <form className="hero-search" onSubmit={(e) => { e.preventDefault(); setParam('q', e.target.q.value); }}>
            <input name="q" defaultValue={q} placeholder={t('home.searchPlaceholder')} aria-label={t('nav.searchAria')} />
            <button className="btn btn-dark" type="submit">{t('common.search')}</button>
          </form>
          <div className="hero-cats" role="tablist" aria-label={t('home.browseAria')}>
            {CATEGORIES.map((c) => (
              <button
                key={c || 'all'}
                role="tab"
                aria-selected={category === c}
                className={`cat-pill ${category === c ? 'active' : ''}`}
                onClick={() => setParam('category', c)}
              >
                {catLabel(c)}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="container">
        <div className="filters" role="search" aria-label={t('home.filterAria')}>
          <label>{t('home.city')}
            <select value={city} onChange={(e) => setParam('city', e.target.value)}>
              <option value="">{t('home.allCities')}</option>
              {cities.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label>{t('home.fromDate')}
            <input type="date" value={dateFrom} onChange={(e) => setParam('dateFrom', e.target.value)} />
          </label>
          <label>{t('home.maxPrice')}
            <input type="number" min="0" step="1" value={priceMax} onChange={(e) => setParam('priceMax', e.target.value)} placeholder="e.g. 100" />
          </label>
          <label>{t('home.sort')}
            <select value={sort} onChange={(e) => setParam('sort', e.target.value)}>
              <option value="upcoming">{t('home.upcoming')}</option>
              <option value="popular">{t('home.mostPopular')}</option>
              <option value="newest">{t('home.newest')}</option>
              <option value="price-asc">{t('home.priceAsc')}</option>
              <option value="price-desc">{t('home.priceDesc')}</option>
            </select>
          </label>
        </div>

        {error && <div className="alert alert-error">{error}</div>}

        <div className="event-grid">
          {events.map((e) => <EventCard key={e.id} event={e} />)}
        </div>

        {loading && <div className="center" style={{ padding: '3rem 0' }}>{t('home.loadingEvents')}</div>}
        {!loading && !events.length && (
          <div className="empty" style={{ padding: '3rem 0', textAlign: 'center' }}>
            <h3>{t('home.noEvents')}</h3>
            <p className="muted">{t('home.noEventsSub')}</p>
          </div>
        )}

        {meta.pages > 1 && (
          <nav className="pagination" aria-label="Pagination">
            <button className="btn btn-ghost btn-sm" disabled={meta.page <= 1} onClick={() => setParam('page', Number(meta.page) - 1)}>{t('home.prev')}</button>
            <span>{t('home.pageOf', { page: meta.page, pages: meta.pages, total: meta.total })}</span>
            <button className="btn btn-ghost btn-sm" disabled={meta.page >= meta.pages} onClick={() => setParam('page', Number(meta.page) + 1)}>{t('home.next')}</button>
          </nav>
        )}
      </section>
    </div>
  );
}