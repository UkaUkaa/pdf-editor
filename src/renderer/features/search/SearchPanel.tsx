import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronUp } from 'lucide-react';
import type { DocumentModel } from '@shared/types/document';
import { useSearchStore } from '../../stores/searchStore';
import { activateHit, replaceAll, replaceCurrent, runSearch, stepHit } from './searchActions';

/** More results than this are counted but not listed, to keep the panel responsive. */
const MAX_LISTED = 300;
const DEBOUNCE_MS = 220;

interface SearchPanelProps {
  document: DocumentModel;
}

/** Search field, options and the list of results for the active document. */
export function SearchPanel({ document }: SearchPanelProps): React.JSX.Element {
  const { t } = useTranslation();
  const query = useSearchStore((state) => state.query);
  const caseSensitive = useSearchStore((state) => state.caseSensitive);
  const wholeWord = useSearchStore((state) => state.wholeWord);
  const hits = useSearchStore((state) => state.hits);
  const active = useSearchStore((state) => state.active);
  const searching = useSearchStore((state) => state.searching);
  const focusRequest = useSearchStore((state) => state.focusRequest);
  const inputRef = useRef<HTMLInputElement>(null);
  const [replacement, setReplacement] = useState('');

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [focusRequest]);

  // Search again whenever the query, the options or the searchable content changes.
  const { id, pages, objects, layers, recognised } = document;
  useEffect(() => {
    const timer = setTimeout(() => void runSearch(), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, caseSensitive, wholeWord, id, pages, objects, layers, recognised]);

  const pageNumbers = new Map(pages.map((page, index) => [page.id, index + 1]));
  let status = '';
  if (query.trim() !== '') {
    if (hits.length > 0) status = t('search.position', { current: active + 1, count: hits.length });
    else status = searching ? t('search.searching') : t('search.noResults');
  }

  return (
    <div className="search">
      <div className="search__controls">
        <div className="search__row">
          <input
            ref={inputRef}
            className="input search__input"
            type="search"
            placeholder={t('search.placeholder')}
            aria-label={t('search.placeholder')}
            value={query}
            onChange={(event) => useSearchStore.getState().setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                stepHit(event.shiftKey ? -1 : 1);
              }
            }}
          />
          <button
            type="button"
            className="icon-button icon-button--small"
            aria-label={t('commands.edit.findPrevious')}
            title={t('commands.edit.findPrevious')}
            aria-disabled={hits.length === 0}
            onClick={() => stepHit(-1)}
          >
            <ChevronUp size={16} aria-hidden />
          </button>
          <button
            type="button"
            className="icon-button icon-button--small"
            aria-label={t('commands.edit.findNext')}
            title={t('commands.edit.findNext')}
            aria-disabled={hits.length === 0}
            onClick={() => stepHit(1)}
          >
            <ChevronDown size={16} aria-hidden />
          </button>
        </div>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={caseSensitive}
            onChange={(event) => useSearchStore.getState().setOptions({ caseSensitive: event.target.checked })}
          />
          <span>{t('search.caseSensitive')}</span>
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={wholeWord}
            onChange={(event) => useSearchStore.getState().setOptions({ wholeWord: event.target.checked })}
          />
          <span>{t('search.wholeWord')}</span>
        </label>
        <div className="search__row">
          <input
            className="input search__input"
            placeholder={t('search.replaceWith')}
            aria-label={t('search.replaceWith')}
            value={replacement}
            onChange={(event) => setReplacement(event.target.value)}
          />
        </div>
        <div className="search__row">
          <button type="button" className="button" disabled={active < 0} onClick={() => void replaceCurrent(replacement)}>
            {t('search.replace')}
          </button>
          <button type="button" className="button" disabled={hits.length === 0} onClick={() => void replaceAll(replacement)}>
            {t('search.replaceAll')}
          </button>
        </div>
        <p className="form-hint">{t('search.replaceNote')}</p>
        <p className="search__status" role="status" data-testid="search-status">
          {status}
        </p>
      </div>
      <ul className="search__results" aria-label={t('sidebar.tabs.search')}>
        {hits.slice(0, MAX_LISTED).map((hit, index) => (
          <li key={index}>
            <button
              type="button"
              className="search-result"
              aria-current={index === active || undefined}
              onClick={() => activateHit(index)}
            >
              <span className="search-result__page">{t('viewer.pageLabel', { number: pageNumbers.get(hit.pageId) ?? '?' })}</span>
              <span className="search-result__text">
                {hit.before}
                <mark>{hit.match}</mark>
                {hit.after}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {hits.length > MAX_LISTED && <p className="search__status">{t('search.truncated', { count: MAX_LISTED })}</p>}
    </div>
  );
}
