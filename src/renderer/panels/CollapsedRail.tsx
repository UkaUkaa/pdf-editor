import { useTranslation } from 'react-i18next';
import { PanelLeftOpen, PanelRightOpen } from 'lucide-react';
import { LEFT_PANEL_TABS } from '@shared/types/settings';
import { useSettingsStore } from '../stores/settingsStore';
import { TAB_ICONS } from './LeftSidebar';

interface CollapsedRailProps {
  side: 'left' | 'right';
}

/**
 * What stays at the edge of the window when a side panel is collapsed: a slim
 * strip with a button that brings the panel back. On the left it also keeps
 * the section icons, so one click opens the panel straight on that section.
 */
export function CollapsedRail({ side }: CollapsedRailProps): React.JSX.Element {
  const { t } = useTranslation();
  const update = useSettingsStore((state) => state.update);
  const left = side === 'left';
  const expandLabel = t(left ? 'sidebar.expand' : 'properties.expand');
  const Expand = left ? PanelLeftOpen : PanelRightOpen;

  return (
    <div
      className={`panel-rail panel-rail--${side}`}
      role="group"
      aria-label={t(left ? 'sidebar.collapsedLabel' : 'properties.collapsedLabel')}
    >
      <button
        type="button"
        className="icon-button panel-rail__expand"
        aria-label={expandLabel}
        title={expandLabel}
        onClick={() => update({ layout: left ? { leftCollapsed: false } : { rightCollapsed: false } })}
      >
        <Expand size={18} strokeWidth={1.75} aria-hidden />
      </button>
      {left && <span className="panel-rail__separator" aria-hidden />}
      {left &&
        LEFT_PANEL_TABS.map((tab) => {
          const Icon = TAB_ICONS[tab];
          return (
            <button
              key={tab}
              type="button"
              className="icon-button"
              aria-label={t(`sidebar.tabs.${tab}`)}
              title={t(`sidebar.tabs.${tab}`)}
              onClick={() => update({ layout: { leftCollapsed: false, leftTab: tab } })}
            >
              <Icon size={18} strokeWidth={1.75} aria-hidden />
            </button>
          );
        })}
    </div>
  );
}
