import React, { useState, useEffect } from 'react';
import { useLang } from '../i18n/LanguageContext.jsx';
import TermsModal from './TermsModal.jsx';

// Checkbox that gates a form on acceptance of the Terms. The box itself cannot
// be ticked directly — checking it opens a scroll-to-end modal, and only the
// accept button (visible at the bottom) actually marks it as accepted.
// Pass `openSignal` (a number) to programmatically open the modal on demand.
export default function TermsConsent({ checked, onChange, kind = 'signup', openSignal = 0 }) {
  const { t } = useLang();
  const [open, setOpen] = useState(false);

  // allow parent to force-open the modal (e.g. pay clicked without acceptance)
  useEffect(() => {
    if (openSignal > 0) setOpen(true);
  }, [openSignal]);

  // clicking the box (when unchecked) must open the terms, not tick the box
  const handleBoxClick = (e) => {
    if (!checked) {
      e.preventDefault();
      setOpen(true);
    }
  };

  return (
    <div className="terms-consent">
      <label className="terms-consent-row">
        <input
          type="checkbox"
          checked={checked}
          onClick={handleBoxClick}
        />
        <span>
          {t('termsConsent.textBefore')}{' '}
          <button type="button" className="terms-link" onClick={() => setOpen(true)}>
            {t('termsConsent.termsAndConditions')}
          </button>{' '}
          {t('termsConsent.and')}{' '}
          <button type="button" className="terms-link" onClick={() => setOpen(true)}>
            {t('termsConsent.termsOfUse')}
          </button>
          .
        </span>
      </label>
      <TermsModal open={open} onClose={() => setOpen(false)} onAccept={() => onChange(true)} kind={kind} />
    </div>
  );
}