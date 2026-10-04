import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en';
import ar from './locales/ar';

let language = 'en';

try {
  language = localStorage.getItem('crm-language') === 'ar' ? 'ar' : 'en';
} catch {
  // Default to English.
}

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    ar: { translation: ar },
  },
  lng: language,
  fallbackLng: 'en',
  supportedLngs: ['en', 'ar'],
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
});

function applyLanguage(value: string) {
  const lang = value === 'ar' ? 'ar' : 'en';

  document.documentElement.lang = lang;
  document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';

  try {
    localStorage.setItem('crm-language', lang);
  } catch {
    // The language still changes in this tab.
  }
}

applyLanguage(language);
i18n.on('languageChanged', applyLanguage);

export default i18n;