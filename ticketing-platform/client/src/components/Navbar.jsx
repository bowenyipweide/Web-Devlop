import React, { useState, useEffect } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useAccessibility } from '../context/AccessibilityContext.jsx';
import { useLang } from '../i18n/LanguageContext.jsx';
import { api } from '../api/client.js';

const A11yMenu = () => {
  const { prefs, setPref } = useAccessibility();
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  const toggle = (k) => setPref(k, !prefs[k]);
  return (
    <div className="a11y-menu">
      <button className="btn btn-ghost btn-sm" aria-expanded={open} onClick={() => setOpen((o) => !o)} title={t('nav.a11yTitle')}>
        {t('nav.a11y')}
      </button>
      {open && (
        <div className="a11y-popover">
          <label className="switch-row">
            <input type="checkbox" checked={prefs.highContrast} onChange={() => toggle('highContrast')} />
            <span>{t('nav.highContrast')}</span>
          </label>
          <label className="switch-row">
            <input type="checkbox" checked={prefs.largerText} onChange={() => toggle('largerText')} />
            <span>{t('nav.largerText')}</span>
          </label>
          <label className="switch-row">
            <input type="checkbox" checked={prefs.reducedMotion} onChange={() => toggle('reducedMotion')} />
            <span>{t('nav.reducedMotion')}</span>
          </label>
        </div>
      )}
    </div>
  );
};

const LanguageSwitch = () => {
  const { lang, setLang } = useLang();
  return (
    <div className="lang-switch" role="group" aria-label="Language">
      <button
        className={`lang-btn${lang === 'en' ? ' active' : ''}`}
        onClick={() => setLang('en')}
        title="English"
      >
        EN
      </button>
      <button
        className={`lang-btn${lang === 'zh' ? ' active' : ''}`}
        onClick={() => setLang('zh')}
        title="中文"
      >
        中文
      </button>
    </div>
  );
};

export default function Navbar() {
  const { user, logout } = useAuth();
  const { t } = useLang();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    if (!user) return;
    let alive = true;
    const load = async () => {
      try {
        const { data } = await api.get('/api/notifications');
        if (alive) setUnread(data.notifications.filter((n) => !n.read).length);
      } catch (e) { /* ignore */ }
    };
    load();
    const iv = setInterval(load, 30000);
    return () => { alive = false; clearInterval(iv); };
  }, [user]);

  const submitSearch = (e) => {
    e.preventDefault();
    navigate(q.trim() ? `/?q=${encodeURIComponent(q.trim())}` : '/');
  };

  const navTo = user?.role === 'admin' ? '/admin' : user?.role === 'organizer' ? '/organizer' : '/account';

  return (
    <header className="navbar">
      <div className="container navbar-inner">
        <Link to="/" className="brand">
          <span className="brand-mark">{t('brand.mark')}</span> Event<span className="brand-soft">{t('brand.namePart')}</span>
        </Link>

        <form className="navsearch" onSubmit={submitSearch} role="search">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('nav.searchPlaceholder')}
            aria-label={t('nav.searchAria')}
          />
          <button className="btn btn-dark btn-sm" type="submit">{t('common.search')}</button>
        </form>

        <nav className="navlinks" aria-label="Main">
          <Link to="/resale" className="navlink">{t('nav.resale')}</Link>
          <A11yMenu />
          <LanguageSwitch />
          {user ? (
            <>
              <NavLink to={navTo} className="navlink">
                {user.name.split(' ')[0]}
                {unread > 0 && <span className="unread-dot" title={`${unread} ${t('nav.unreadNotifications')}`}>{unread}</span>}
                <span className={`pill ${user.role === 'admin' ? 'pill-admin' : user.role === 'organizer' ? 'pill-org' : 'pill-cust'}`}>{user.role}</span>
              </NavLink>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => { logout(); navigate('/'); }}
              >{t('nav.logout')}</button>
            </>
          ) : (
            <>
              <Link to="/login" className="btn btn-ghost btn-sm">{t('nav.login')}</Link>
              <Link to="/register" className="btn btn-dark btn-sm">{t('nav.signup')}</Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}