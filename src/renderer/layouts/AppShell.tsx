import { useState } from 'react';
import { DEFAULT_LAYOUT } from '@shared/types/settings';
import { MenuBar } from '../components/MenuBar';
import { ResizeHandle } from '../components/ResizeHandle';
import { StatusBar } from '../components/StatusBar';
import { DocumentTabs } from '../features/documents/DocumentTabs';
import { Workspace } from '../features/workspace/Workspace';
import { CollapsedRail } from '../panels/CollapsedRail';
import { LeftSidebar } from '../panels/LeftSidebar';
import { PropertiesPanel } from '../panels/PropertiesPanel';
import { useSettingsStore } from '../stores/settingsStore';
import { Toolbar } from '../toolbar/Toolbar';

interface AppShellProps {
  isMac: boolean;
}

/**
 * Main window layout: menu bar, toolbar, three resizable columns and a status bar.
 * A collapsed side panel leaves a slim strip in its place, from which it is opened again.
 */
export function AppShell({ isMac }: AppShellProps): React.JSX.Element {
  const layout = useSettingsStore((state) => state.settings.layout);
  const update = useSettingsStore((state) => state.update);
  // While a handle is dragged the width lives in local state; it is persisted on release.
  const [dragLeft, setDragLeft] = useState<number | null>(null);
  const [dragRight, setDragRight] = useState<number | null>(null);

  const leftWidth = dragLeft ?? layout.leftWidth;
  const rightWidth = dragRight ?? layout.rightWidth;

  return (
    <div className="app">
      {!isMac && <MenuBar />}
      <Toolbar />
      <DocumentTabs />
      <div className="app__body">
        {layout.leftCollapsed ? (
          <CollapsedRail side="left" />
        ) : (
          <>
            <LeftSidebar width={leftWidth} />
            <ResizeHandle
              side="left"
              width={leftWidth}
              defaultWidth={DEFAULT_LAYOUT.leftWidth}
              onResize={setDragLeft}
              onCommit={(width) => {
                setDragLeft(null);
                update({ layout: { leftWidth: width } });
              }}
            />
          </>
        )}
        <Workspace />
        {layout.rightCollapsed ? (
          <CollapsedRail side="right" />
        ) : (
          <>
            <ResizeHandle
              side="right"
              width={rightWidth}
              defaultWidth={DEFAULT_LAYOUT.rightWidth}
              onResize={setDragRight}
              onCommit={(width) => {
                setDragRight(null);
                update({ layout: { rightWidth: width } });
              }}
            />
            <PropertiesPanel width={rightWidth} />
          </>
        )}
      </div>
      <StatusBar />
    </div>
  );
}
