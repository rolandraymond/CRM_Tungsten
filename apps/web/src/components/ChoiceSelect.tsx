import { useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ReactNode } from 'react';
export type ChoiceOption = {
  value: string;
  label: string;
  description?: string;
  searchText?: string;
  image?: string | null;
};

export function ChoiceImage({
  src,
}: {
  src?: string | null;
}) {
  const { i18n } = useTranslation();

  const ar = (
    i18n.resolvedLanguage ?? i18n.language
  ).startsWith('ar');

  const safe =
    src && /^https?:\/\//i.test(src) ? src : null;

  return (
    <span className="choice-image">
      <span>{ar ? 'بدون صورة' : 'No image'}</span>

      {safe && (
        <img
          key={safe}
          src={safe}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={event => {
            event.currentTarget.hidden = true;
          }}
        />
      )}
    </span>
  );
}

export default function ChoiceSelect({
  label,
  value,
  options,
  onChange,
  placeholder,
  disabled = false,
  icon,
}: {
  label: string;
  value: string;
  options: ChoiceOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  icon?: ReactNode;
}) {
  const { i18n } = useTranslation();

  const ar = (
    i18n.resolvedLanguage ?? i18n.language
  ).startsWith('ar');

  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);

  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);

  const selected = options.find(
    option => option.value === value,
  );

  const needle = search.trim().toLocaleLowerCase();

  const filtered = options.filter(option =>
    [
      option.label,
      option.description ?? '',
      option.searchText ?? '',
    ]
      .join(' ')
      .toLocaleLowerCase()
      .includes(needle),
  );

  function show() {
    if (disabled) return;

    setSearch('');
    dialog.current?.showModal();
    setOpen(true);
    searchInput.current?.focus();
  }

  return (
    <div className="choice-field">
      <label
        className="form-label"
        htmlFor={`${id}-trigger`}
      >
        {label}
      </label>

      <button
        id={`${id}-trigger`}
        type="button"
        className="choice-trigger"
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={`${id}-dialog`}
        aria-describedby={`${id}-value`}
        onClick={show}
      >
        {icon && (
            <span
              className="grid size-8 shrink-0 place-items-center rounded-full bg-lavender"
              aria-hidden="true"
            >
              {icon}
            </span>
          )}
        <span
          id={`${id}-value`}
          className={`flex-1 text-start ${selected ? '' : 'choice-placeholder'}`}
          dir="auto"
        >
          {selected?.label ||
            placeholder ||
            (ar ? 'اختار…' : 'Choose…')}
        </span>

        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="m6 9 6 6 6-6"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
          />
        </svg>
      </button>

      <dialog
        ref={dialog}
        id={`${id}-dialog`}
        className="choice-dialog"
        dir={ar ? 'rtl' : 'ltr'}
        aria-labelledby={`${id}-title`}
        onClose={() => {
          setOpen(false);
          setSearch('');
        }}
        onClick={event => {
          if (event.target === event.currentTarget) {
            dialog.current?.close();
          }
        }}
      >
        <div className="choice-panel">
          <div className="choice-heading">
            <h2 id={`${id}-title`}>{label}</h2>

            <button
              type="button"
              className="choice-close"
              onClick={() => dialog.current?.close()}
              aria-label={ar ? 'إغلاق' : 'Close'}
            >
              ×
            </button>
          </div>

          <input
            ref={searchInput}
            type="search"
            className="field choice-search"
            aria-label={
              ar ? 'بحث في الاختيارات' : 'Search options'
            }
            placeholder={
              ar ? 'اكتب للبحث…' : 'Type to search…'
            }
            value={search}
            onChange={event => setSearch(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter') {
                event.preventDefault();
              }
            }}
          />

          <div className="choice-results">
            {filtered.map(option => (
              <button
                key={option.value}
                type="button"
                className="choice-option"
                aria-pressed={option.value === value}
                disabled={disabled}
                onClick={() => {
                  onChange(option.value);
                  dialog.current?.close();
                }}
              >
              {icon && (
                <span
                  className="grid size-9 shrink-0 place-items-center rounded-full bg-lavender"
                  aria-hidden="true"
                >
                  {icon}
                </span>
              )}
                {option.image !== undefined && (
                  <ChoiceImage src={option.image} />
                )}

                <span className="choice-option-copy">
                  <span
                    className="choice-option-title"
                    dir="auto"
                  >
                    {option.label}
                  </span>

                  {option.description && (
                    <span
                      className="choice-description"
                      dir="auto"
                    >
                      {option.description}
                    </span>
                  )}
                </span>

                <span
                  className="choice-check"
                  aria-hidden="true"
                >
                  {option.value === value ? '✓' : ''}
                </span>
              </button>
            ))}

            {!filtered.length && (
              <p className="choice-empty" role="status">
                {ar
                  ? 'مفيش نتائج مطابقة.'
                  : 'No matching results.'}
              </p>
            )}
          </div>
        </div>
      </dialog>
    </div>
  );
}