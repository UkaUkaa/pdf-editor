import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { COMMAND_IDS, getCommand } from '@shared/menu/commands';
import { DEFAULT_LAYOUT, DEFAULT_SETTINGS } from '@shared/types/settings';
import { App } from '@renderer/app/App';
import { computeCommandState, currentCommandContext, isCommandImplemented } from '@renderer/services/commands';
import { setupApp } from './testUtils';

describe('application shell', () => {
  it('renders every region of the main layout', async () => {
    await setupApp();
    render(<App />);
    expect(screen.getByRole('menubar', { name: 'Main menu' })).toBeInTheDocument();
    expect(screen.getByRole('toolbar', { name: 'Main toolbar' })).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: 'Navigation panel' })).toBeInTheDocument();
    expect(screen.getByRole('main', { name: 'Document workspace' })).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: 'Properties panel' })).toBeInTheDocument();
    expect(screen.getByRole('contentinfo', { name: 'Status bar' })).toBeInTheDocument();
  });

  it('hides the in-window menu bar on macOS, where the native menu is used', async () => {
    await setupApp({ platform: 'darwin' });
    render(<App />);
    expect(screen.queryByRole('menubar')).not.toBeInTheDocument();
  });

  it.each([
    ['en', 'Open a PDF to get started', 'File'],
    ['ru', 'Откройте PDF, чтобы начать', 'Файл'],
    ['uk', 'Відкрийте PDF, щоб почати', 'Файл'],
  ] as const)('renders in %s', async (language, title, fileMenu) => {
    await setupApp({ settings: { ...DEFAULT_SETTINGS, language } });
    render(<App />);
    expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: fileMenu })).toBeInTheDocument();
    expect(document.documentElement.lang).toBe(language);
  });

  it('switches language live from the settings dialog and persists it', async () => {
    const user = userEvent.setup();
    const api = await setupApp();
    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Preferences…' }));
    const dialog = screen.getByRole('dialog', { name: 'Preferences' });
    await user.selectOptions(within(dialog).getByLabelText('Interface language'), 'ru');

    expect(await screen.findByRole('dialog', { name: 'Параметры' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Откройте PDF, чтобы начать' })).toBeInTheDocument();
    expect(api.current().language).toBe('ru');

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('applies and persists the theme', async () => {
    const user = userEvent.setup();
    const api = await setupApp({ settings: { ...DEFAULT_SETTINGS, theme: 'light' } });
    render(<App />);
    expect(document.documentElement.dataset['theme']).toBe('light');

    await user.click(screen.getByRole('button', { name: 'Switch theme' }));
    expect(document.documentElement.dataset['theme']).toBe('dark');
    expect(api.current().theme).toBe('dark');
  });

  it('opens collapsed side panels from the strips left at the window edges', async () => {
    const user = userEvent.setup();
    const api = await setupApp();
    render(<App />);
    expect(screen.queryByRole('group', { name: 'Navigation panel, collapsed' })).not.toBeInTheDocument();

    // Collapse both panels with their own buttons.
    await user.click(within(screen.getByRole('complementary', { name: 'Navigation panel' })).getByRole('button', { name: 'Collapse panel' }));
    await user.click(within(screen.getByRole('complementary', { name: 'Properties panel' })).getByRole('button', { name: 'Collapse panel' }));
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();

    // Each leaves a strip in its place with a button that brings it back.
    const leftRail = screen.getByRole('group', { name: 'Navigation panel, collapsed' });
    const rightRail = screen.getByRole('group', { name: 'Properties panel, collapsed' });
    await user.click(within(rightRail).getByRole('button', { name: 'Show properties panel' }));
    expect(screen.getByRole('complementary', { name: 'Properties panel' })).toBeInTheDocument();
    expect(api.current().layout.rightCollapsed).toBe(false);
    expect(screen.queryByRole('group', { name: 'Properties panel, collapsed' })).not.toBeInTheDocument();

    // A section icon on the left strip opens the panel straight on that section.
    await user.click(within(leftRail).getByRole('button', { name: 'Layers' }));
    expect(api.current().layout).toMatchObject({ leftCollapsed: false, leftTab: 'layers' });
    expect(within(screen.getByRole('complementary', { name: 'Navigation panel' })).getByRole('tab', { name: 'Layers' })).toHaveAttribute('aria-selected', 'true');

    // The plain expand button keeps the section that was open before.
    await user.click(within(screen.getByRole('complementary', { name: 'Navigation panel' })).getByRole('button', { name: 'Collapse panel' }));
    await user.click(within(screen.getByRole('group', { name: 'Navigation panel, collapsed' })).getByRole('button', { name: 'Expand panel' }));
    expect(api.current().layout).toMatchObject({ leftCollapsed: false, leftTab: 'layers' });
  });

  it('collapses, restores and resets side panels', async () => {
    const user = userEvent.setup();
    const api = await setupApp();
    render(<App />);
    const toolbar = screen.getByRole('toolbar');

    await user.click(within(toolbar).getByRole('button', { name: 'Navigation Panel' }));
    expect(screen.queryByRole('complementary', { name: 'Navigation panel' })).not.toBeInTheDocument();
    expect(api.current().layout.leftCollapsed).toBe(true);

    await user.click(within(toolbar).getByRole('button', { name: 'Navigation Panel' }));
    expect(screen.getByRole('complementary', { name: 'Navigation panel' })).toBeInTheDocument();

    await user.click(within(screen.getByRole('complementary', { name: 'Properties panel' })).getByRole('button'));
    expect(api.current().layout.rightCollapsed).toBe(true);

    await user.click(screen.getByRole('menuitem', { name: 'View' }));
    await user.click(screen.getByRole('menuitem', { name: 'Reset Layout' }));
    expect(api.current().layout).toEqual(DEFAULT_LAYOUT);
    expect(screen.getByRole('complementary', { name: 'Properties panel' })).toBeInTheDocument();
  });

  it('switches sidebar tabs and remembers the selection', async () => {
    const user = userEvent.setup();
    const api = await setupApp();
    render(<App />);

    await user.click(screen.getByRole('tab', { name: 'Layers' }));
    expect(screen.getByRole('tab', { name: 'Layers' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel', { name: 'Layers' })).toBeInTheDocument();
    expect(api.current().layout.leftTab).toBe('layers');
  });

  it('resizes a panel with the keyboard within the allowed range', async () => {
    const api = await setupApp();
    render(<App />);
    const [leftHandle] = screen.getAllByRole('separator', { name: 'Resize panel' });

    fireEvent.keyDown(leftHandle!, { key: 'ArrowRight' });
    await waitFor(() => expect(api.current().layout.leftWidth).toBe(DEFAULT_LAYOUT.leftWidth + 16));
    expect(screen.getByRole('complementary', { name: 'Navigation panel' })).toHaveStyle({
      width: `${DEFAULT_LAYOUT.leftWidth + 16}px`,
    });
  });

  it('executes commands sent by the native menu and publishes command state', async () => {
    const api = await setupApp({ platform: 'darwin' });
    render(<App />);
    expect(api.menu.setState).toHaveBeenCalledWith(computeCommandState(currentCommandContext()));

    act(() => api.emitCommand('help.about'));
    const dialog = await screen.findByRole('dialog', { name: 'About' });
    expect(await within(dialog).findByText('9.9.9')).toBeInTheDocument();

    // A command without an implementation must be ignored, never half-executed.
    act(() => api.emitCommand('file.print'));
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
  });

  it('handles keyboard shortcuts on platforms without a native menu', async () => {
    await setupApp({ platform: 'win32' });
    render(<App />);
    fireEvent.keyDown(window, { key: ',', ctrlKey: true });
    expect(await screen.findByRole('dialog', { name: 'Preferences' })).toBeInTheDocument();
  });
});

describe('menu bar', () => {
  it('disables commands that are not implemented and explains when they arrive', async () => {
    const user = userEvent.setup();
    const api = await setupApp();
    render(<App />);

    await user.click(screen.getByRole('menuitem', { name: 'File' }));
    const save = screen.getByRole('menuitem', { name: /^Print/ });
    expect(save).toHaveAttribute('aria-disabled', 'true');
    expect(save).toHaveAttribute('title', expect.stringContaining('phase 6'));
    // Implemented, but needs an open document: disabled without the "planned" hint.
    const close = screen.getByRole('menuitem', { name: /Close Document/ });
    expect(close).toHaveAttribute('aria-disabled', 'true');
    expect(close).not.toHaveAttribute('title');

    await user.click(save);
    // The menu stays open and nothing happens.
    expect(screen.getByRole('menu', { name: 'File' })).toBeInTheDocument();

    await user.click(screen.getByRole('menuitem', { name: /Exit/ }));
    expect(api.app.performRole).toHaveBeenCalledWith('quit');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('reflects radio state in submenus', async () => {
    const user = userEvent.setup();
    const api = await setupApp({ settings: { ...DEFAULT_SETTINGS, language: 'en' } });
    render(<App />);

    await user.click(screen.getByRole('menuitem', { name: 'Settings' }));
    await user.click(screen.getByRole('menuitem', { name: 'Language' }));
    expect(screen.getByRole('menuitemradio', { name: 'English' })).toHaveAttribute('aria-checked', 'true');
    await user.click(screen.getByRole('menuitemradio', { name: 'Українська' }));

    expect(api.current().language).toBe('uk');
    expect(await screen.findByRole('menuitem', { name: 'Налаштування' })).toBeInTheDocument();
  });

  it('only commands of finished phases are implemented', () => {
    const implemented = COMMAND_IDS.filter(isCommandImplemented);
    expect(implemented).toContain('settings.preferences');
    expect(implemented).toContain('file.open');
    expect(implemented).toContain('view.zoomIn');
    for (const id of implemented) expect(getCommand(id).phase, id).toBeLessThanOrEqual(8); // the last phase
    expect(implemented).toContain('file.save');
    expect(implemented).not.toContain('file.print');
    expect(implemented).not.toContain('tools.compress');
  });
});
