import { createContext, useContext, useState, useEffect } from 'react';
import { useAuth } from './AuthContext.jsx';
import { api } from '../api/client.js';

const AccessibilityContext = createContext(null);
export const useAccessibility = () => useContext(AccessibilityContext);

const KEY = 'eventease_accessibility';
const DEFAULTS = { highContrast: false, largerText: false, reducedMotion: false };

const read = () => {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch (e) {
    return DEFAULTS;
  }
};

export const AccessibilityProvider = ({ children }) => {
  const { user } = useAuth();
  const [prefs, setPrefs] = useState(read);

  // Merge account-synced accessibility prefs when a user is present.
  useEffect(() => {
    if (user?.accessibility) {
      setPrefs((p) => ({ ...p, ...user.accessibility }));
    }
  }, [user]);

  useEffect(() => {
    const root = document.body;
    const html = document.documentElement;
    html.classList.toggle('a11y-text', prefs.largerText);
    root.classList.toggle('a11y-contrast', prefs.highContrast);
    root.classList.toggle('a11y-motion', prefs.reducedMotion);
    localStorage.setItem(KEY, JSON.stringify(prefs));
  }, [prefs]);

  const setPref = (key, value) => {
    setPrefs((p) => ({ ...p, [key]: value }));
    // Persist to the account when a change is made, so the preference
    // follows the user across devices and logins. If a user is present,
    // sync the full accessibility object.
    if (user) {
      const next = { ...prefs, [key]: value };
      api.patch('/api/users/profile', { accessibility: next }).catch(() => {});
    }
  };

  return (
    <AccessibilityContext.Provider value={{ prefs, setPref }}>
      {children}
    </AccessibilityContext.Provider>
  );
};