import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { AboutDialog } from '../dialogs/AboutDialog';
import { ConfirmDialog } from '../dialogs/ConfirmDialog';
import { NoticeDialog } from '../dialogs/NoticeDialog';
import { PasswordDialog } from '../dialogs/PasswordDialog';
import { ExportImagesDialog, OcrDialog } from '../dialogs/ProcessingDialogs';
import { ProtectDialog } from '../dialogs/ProtectDialog';
import { RecoveryDialog } from '../dialogs/RecoveryDialog';
import { SettingsDialog } from '../dialogs/SettingsDialog';
import { SplitDialog } from '../dialogs/SplitDialog';
import { HeaderFooterDialog, WatermarkDialog } from '../dialogs/StampDialogs';
import { useCommandBindings } from '../hooks/useCommandBindings';
import { useResolvedTheme } from '../hooks/useResolvedTheme';
import { AppShell } from '../layouts/AppShell';
import { openPaths } from '../features/documents/documentActions';
import { useDocumentFonts } from '../hooks/useDocumentFonts';
import { useAutosave } from '../features/project/autosave';
import { checkRecovery } from '../features/project/recovery';
import { selectActiveDocument, useDocumentsStore } from '../stores/documentsStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useUiStore } from '../stores/uiStore';

export function App(): React.JSX.Element {
  const { i18n, t } = useTranslation();
  const language = useSettingsStore((state) => state.settings.language);
  const theme = useSettingsStore((state) => state.settings.theme);
  const dialog = useUiStore((state) => state.dialog);
  const closeDialog = useUiStore((state) => state.closeDialog);
  const notice = useUiStore((state) => state.notice);
  const dismissNotice = useUiStore((state) => state.dismissNotice);
  const passwordRequest = useUiStore((state) => state.passwordRequest);
  const answerPassword = useUiStore((state) => state.answerPassword);
  const confirmRequest = useUiStore((state) => state.confirmRequest);
  const answerConfirm = useUiStore((state) => state.answerConfirm);
  const activeName = useDocumentsStore((state) => selectActiveDocument(state)?.name);
  const isMac = window.api.platform === 'darwin';

  useResolvedTheme(theme);
  useCommandBindings(isMac);
  useAutosave();
  useDocumentFonts();

  // Files passed by the operating system: those that came with the launch, then any later ones.
  useEffect(() => {
    void window.api.documents.takeOpenRequests().then((paths) => openPaths(paths));
    return window.api.documents.onOpenRequest((paths) => void openPaths(paths));
  }, []);

  // Documents left unsaved by a crash are offered for recovery once, at start.
  useEffect(() => {
    void checkRecovery();
  }, []);

  useEffect(() => {
    if (i18n.language !== language) void i18n.changeLanguage(language);
    document.documentElement.lang = language;
  }, [i18n, language]);

  // The operating-system user name is the default author of comments.
  useEffect(() => {
    void window.api.app.getInfo().then((info) => useUiStore.setState({ systemUserName: info.userName }));
  }, []);

  useEffect(() => {
    document.title = activeName ? `${activeName} — ${t('app.name')}` : t('app.name');
  }, [t, activeName]);

  return (
    <>
      <AppShell isMac={isMac} />
      {dialog === 'settings' && <SettingsDialog onClose={closeDialog} />}
      {dialog === 'about' && <AboutDialog onClose={closeDialog} />}
      {dialog === 'protect' && <ProtectDialog onClose={closeDialog} />}
      {dialog === 'split' && <SplitDialog onClose={closeDialog} />}
      {dialog === 'watermark' && <WatermarkDialog onClose={closeDialog} />}
      {dialog === 'ocr' && <OcrDialog onClose={closeDialog} />}
      {dialog === 'exportImages' && <ExportImagesDialog onClose={closeDialog} />}
      {dialog === 'headerFooter' && <HeaderFooterDialog onClose={closeDialog} />}
      <RecoveryDialog />
      {confirmRequest && <ConfirmDialog request={confirmRequest} onAnswer={answerConfirm} />}
      {notice && <NoticeDialog notice={notice} onClose={dismissNotice} />}
      {passwordRequest && (
        // Keyed so a retry after a wrong password starts with an empty field.
        <PasswordDialog key={passwordRequest.reason} request={passwordRequest} onAnswer={answerPassword} />
      )}
    </>
  );
}
