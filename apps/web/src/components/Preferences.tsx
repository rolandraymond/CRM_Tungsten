import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Moon, Sun, Languages } from 'lucide-react';

export default function Preferences() {
  const { t, i18n } = useTranslation();

  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try {
      return localStorage.getItem('crm-theme') === 'dark' ? 'dark' : 'light';
    } catch {
      return 'light';
    }
  });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;

    try {
      localStorage.setItem('crm-theme', theme);
    } catch {
      // Keep the current tab preference.
    }
  }, [theme]);

  const themeLabel = t(
    theme === 'dark' ? 'common.light' : 'common.dark',
  );

  return (
    <div className="flex shrink-0 gap-2">
      <button
        className="control"
        type="button"
        onClick={() => void i18n.changeLanguage(
          i18n.resolvedLanguage === 'ar' ? 'en' : 'ar',
        )}
      >
        <Languages size={16} aria-hidden="true" />
        <span>{t('common.language')}</span>
      </button>

      <button
        className="control"
        type="button"
        aria-label={themeLabel}
        title={themeLabel}
        onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
      >
        {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
      </button>
    </div>
  );
}