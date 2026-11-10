import { useTranslation } from 'react-i18next';
import {
  Bookmark,
  Layers,
  LayoutGrid,
  ListTree,
  MessagesSquare,
  PanelLeftClose,
  Paperclip,
  Search,
  type LucideIcon,
} from 'lucide-react';
import { LEFT_PANEL_TABS, type LeftPanelTab } from '@shared/types/settings';
import { CommandButton } from '../components/CommandButton';
import { AttachmentsPanel } from '../features/attachments/AttachmentsPanel';
import { BookmarksPanel } from '../features/bookmarks/BookmarksPanel';
import { CommentsPanel } from '../features/comments/CommentsPanel';
import { LayersPanel } from '../features/layers/LayersPanel';
import { ThumbnailsPanel } from '../features/pages/ThumbnailsPanel';
import { SearchPanel } from '../features/search/SearchPanel';
import { selectActiveDocument, useDocumentsStore } from '../stores/documentsStore';
import { useSettingsStore } from '../stores/settingsStore';

const TAB_ICONS: Record<LeftPanelTab, LucideIcon> = {
  thumbnails: LayoutGrid,
  bookmarks: Bookmark,
  outline: ListTree,
  attachments: Paperclip,
  search: Search,
  layers: Layers,
  comments: MessagesSquare,
};

interface LeftSidebarProps {
  width: number;
}

/** Switchable navigation panels. Each panel is filled in by its feature module in later phases. */
export function LeftSidebar({ width }: LeftSidebarProps): React.JSX.Element {
  const { t } = useTranslation();
  const activeTab = useSettingsStore((state) => state.settings.layout.leftTab);
  const update = useSettingsStore((state) => state.update);
  const activeDocument = useDocumentsStore(selectActiveDocument);
  const select = (tab: LeftPanelTab): void => update({ layout: { leftTab: tab } });

  const onKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const index = LEFT_PANEL_TABS.indexOf(activeTab);
    const step = event.key === 'ArrowDown' ? 1 : -1;
    const next = LEFT_PANEL_TABS[(index + step + LEFT_PANEL_TABS.length) % LEFT_PANEL_TABS.length];
    if (!next) return;
    select(next);
    document.getElementById(`sidebar-tab-${next}`)?.focus();
  };

  return (
    <aside className="sidebar" aria-label={t('sidebar.label')} style={{ width }}>
      <div
        className="sidebar__tabs"
        role="tablist"
        aria-orientation="vertical"
        aria-label={t('sidebar.tabsLabel')}
        onKeyDown={onKeyDown}
      >
        {LEFT_PANEL_TABS.map((tab) => {
          const Icon = TAB_ICONS[tab];
          const selected = tab === activeTab;
          return (
            <button
              key={tab}
              id={`sidebar-tab-${tab}`}
              type="button"
              role="tab"
              className="icon-button sidebar__tab"
              aria-selected={selected}
              aria-controls="sidebar-panel"
              aria-label={t(`sidebar.tabs.${tab}`)}
              title={t(`sidebar.tabs.${tab}`)}
              tabIndex={selected ? 0 : -1}
              onClick={() => select(tab)}
            >
              <Icon size={18} strokeWidth={1.75} aria-hidden />
            </button>
          );
        })}
      </div>
      <section id="sidebar-panel" className="panel" role="tabpanel" aria-labelledby={`sidebar-tab-${activeTab}`}>
        <header className="panel__header">
          <h2 className="panel__title">{t(`sidebar.tabs.${activeTab}`)}</h2>
          {activeTab === 'thumbnails' && activeDocument && (
            <span className="panel__commands">
              <CommandButton id="pages.addBlank" small />
              <CommandButton id="pages.rotateCcw" small />
              <CommandButton id="pages.rotateCw" small />
              <CommandButton id="pages.delete" small />
            </span>
          )}
          {activeTab === 'bookmarks' && activeDocument && (
            <span className="panel__commands">
              <CommandButton id="insert.bookmark" small />
            </span>
          )}
          {activeTab === 'comments' && activeDocument && (
            <span className="panel__commands">
              <CommandButton id="tools.comment" small />
            </span>
          )}
          {activeTab === 'attachments' && activeDocument && (
            <span className="panel__commands">
              <CommandButton id="insert.attachment" small />
            </span>
          )}
          {activeTab === 'layers' && activeDocument && (
            <span className="panel__commands">
              <CommandButton id="layers.new" small />
              <CommandButton id="layers.moveUp" small />
              <CommandButton id="layers.moveDown" small />
              <CommandButton id="layers.delete" small />
            </span>
          )}
          <button
            type="button"
            className="icon-button icon-button--small"
            aria-label={t('sidebar.collapse')}
            title={t('sidebar.collapse')}
            onClick={() => update({ layout: { leftCollapsed: true } })}
          >
            <PanelLeftClose size={16} strokeWidth={1.75} aria-hidden />
          </button>
        </header>
        {activeTab === 'thumbnails' && activeDocument ? (
          <ThumbnailsPanel key={activeDocument.id} document={activeDocument} />
        ) : activeTab === 'layers' && activeDocument ? (
          <LayersPanel document={activeDocument} />
        ) : activeTab === 'bookmarks' && activeDocument ? (
          <BookmarksPanel document={activeDocument} />
        ) : activeTab === 'comments' && activeDocument ? (
          <CommentsPanel document={activeDocument} />
        ) : activeTab === 'attachments' && activeDocument ? (
          <AttachmentsPanel document={activeDocument} />
        ) : activeTab === 'search' && activeDocument ? (
          <SearchPanel document={activeDocument} />
        ) : (
          <p className="panel__empty">{t(`sidebar.empty.${activeTab}`)}</p>
        )}
      </section>
    </aside>
  );
}
