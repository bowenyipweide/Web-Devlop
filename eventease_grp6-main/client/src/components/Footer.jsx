import React from 'react';
import { Link } from 'react-router-dom';
import { useLang } from '../i18n/LanguageContext.jsx';

export default function Footer() {
  const { t } = useLang();
  return (
    <footer className="footer">
      <div className="container footer-grid">
        <div>
          <div className="brand"><span className="brand-mark">{t('brand.mark')}</span> Event<span className="brand-soft">{t('brand.namePart')}</span></div>
          <p className="muted">{t('footer.tagline')}</p>
        </div>
        <div>
          <h4>{t('footer.explore')}</h4>
          <ul>
            <li><Link to="/">{t('footer.browseEvents')}</Link></li>
            <li><Link to="/resale">{t('footer.resaleMarket')}</Link></li>
            <li><Link to="/register?role=organizer">{t('footer.becomeOrganizer')}</Link></li>
          </ul>
        </div>
        <div>
          <h4>{t('footer.support')}</h4>
          <ul>
            <li><span>{t('footer.qrValidation')}</span></li>
            <li><span>{t('footer.transfersRefunds')}</span></li>
            <li><span>{t('footer.accessibility')}</span></li>
          </ul>
        </div>
        <div>
          <h4>{t('footer.legal')}</h4>
          <ul>
            <li><Link to="/terms">{t('footer.termsOfUse')}</Link></li>
            <li><Link to="/terms-and-conditions">{t('footer.termsAndConditions')}</Link></li>
          </ul>
        </div>
      </div>
      <div className="container footer-bottom">
        <span>{t('footer.copyright', { year: new Date().getFullYear() })}</span>
        <span className="muted">{t('brand.name')}</span>
      </div>
    </footer>
  );
}