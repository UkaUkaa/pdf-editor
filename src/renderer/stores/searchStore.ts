import { create } from 'zustand';
import type { SearchHit, SearchOptions } from '../engine/search/search';

interface SearchState extends SearchOptions {
  query: string;
  /** Document the current results belong to. */
  documentId: string | null;
  hits: SearchHit[];
  /** Index into `hits` of the result the user is at, or -1. */
  active: number;
  searching: boolean;
  /** Incremented to ask the search field to take the keyboard focus. */
  focusRequest: number;
  setQuery: (query: string) => void;
  setOptions: (options: Partial<SearchOptions>) => void;
  setResults: (documentId: string, hits: SearchHit[], searching: boolean) => void;
  setActive: (index: number) => void;
  requestFocus: () => void;
  clear: () => void;
}

/** Query and results of the document search. */
export const useSearchStore = create<SearchState>((set) => ({
  query: '',
  caseSensitive: false,
  wholeWord: false,
  documentId: null,
  hits: [],
  active: -1,
  searching: false,
  focusRequest: 0,
  setQuery: (query) => set({ query }),
  setOptions: (options) => set(options),
  setResults: (documentId, hits, searching) =>
    set((state) => ({
      documentId,
      hits,
      searching,
      // Keep the position while results of the same search keep arriving.
      active: hits.length === 0 ? -1 : Math.min(Math.max(state.active, 0), hits.length - 1),
    })),
  setActive: (active) => set({ active }),
  requestFocus: () => set((state) => ({ focusRequest: state.focusRequest + 1 })),
  clear: () => set({ query: '', hits: [], active: -1, searching: false, documentId: null }),
}));

export function resetSearchStore(): void {
  useSearchStore.setState({
    query: '',
    caseSensitive: false,
    wholeWord: false,
    documentId: null,
    hits: [],
    active: -1,
    searching: false,
    focusRequest: 0,
  });
}
