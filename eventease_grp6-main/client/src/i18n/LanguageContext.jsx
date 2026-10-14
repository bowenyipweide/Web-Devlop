import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import en from './en.js';
import zh from './zh.js';

const LanguageContext = createContext(null);
export const useLang = () => useContext(LanguageContext);

const KEY = 'eventease_lang';
const DICTIONARIES = { en, zh };

const readLang = () => {
  const saved = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null;
  return saved === 'zh' ? 'zh' : 'en';
};

// Dot/caret path lookup supporting array indices, e.g. t('home.pageOf').
const lookup = (obj, path) => {
  return String(path).split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
};

const flattenInterpolation = (value, vars) => {
  if (typeof value !== 'string') return value;
  return value.replace(/\{(\w+)\}/g, (match, name) =>
    vars && name in vars ? String(vars[name]) : match
  );
};

export const LanguageProvider = ({ children }) => {
  const [lang, setLangState] = useState(readLang);

  useEffect(() => {
    document.documentElement.lang = lang;
    localStorage.setItem(KEY, lang);
  }, [lang]);

  const setLang = useCallback((next) => setLangState(next === 'zh' ? 'zh' : 'en'), []);
  const toggleLang = useCallback(() => setLangState((l) => (l === 'zh' ? 'en' : 'zh')), []);

  const t = useCallback(
    (key, vars) => {
      const value = lookup(DICTIONARIES[lang], key);
      if (typeof value === 'string') return flattenInterpolation(value, vars);
      const fallback = lookup(DICTIONARIES.en, key);
      if (typeof fallback === 'string') return flattenInterpolation(fallback, vars);
      return key;
    },
    [lang]
  );

  return (
    <LanguageContext.Provider value={{ lang, setLang, toggleLang, t, dict: DICTIONARIES[lang] }}>
      {children}
    </LanguageContext.Provider>
  );
};