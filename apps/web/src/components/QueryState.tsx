import { useTranslation } from 'react-i18next';

export default function QueryState({
  error = false,
  retry,
}: {
  error?: boolean;
  retry?: () => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="glass p-6" role={error ? 'alert' : 'status'}>
      <p className={error ? 'text-danger' : 'text-muted'}>
        {t(error ? 'common.error' : 'common.loading')}
      </p>

      {error && retry && (
        <button type="button" className="control mt-4" onClick={retry}>
          {t('common.retry')}
        </button>
      )}
    </div>
  );
}