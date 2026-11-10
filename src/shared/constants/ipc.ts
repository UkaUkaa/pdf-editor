/** Every IPC channel used by the application. Nothing else is exposed to the renderer. */
export const IPC = {
  settingsGet: 'settings:get',
  settingsUpdate: 'settings:update',
  settingsChanged: 'settings:changed',
  menuSetState: 'menu:set-state',
  menuCommand: 'menu:command',
  appGetInfo: 'app:get-info',
  appPerformRole: 'app:perform-role',
  documentsOpenDialog: 'documents:open-dialog',
  documentsOpenPaths: 'documents:open-paths',
  documentsTakeOpenRequests: 'documents:take-open-requests',
  documentsOpenRequested: 'documents:open-requested',
  documentsOpenImagesDialog: 'documents:open-images-dialog',
  documentsSaveDialog: 'documents:save-dialog',
  documentsWriteFile: 'documents:write-file',
  documentsChooseDirectory: 'documents:choose-directory',
  documentsWriteToDirectory: 'documents:write-to-directory',
  documentsWriteImage: 'documents:write-image',
  appSetDirty: 'app:set-dirty',
  appOpenExternal: 'app:open-external',
  documentsOpenAttachmentsDialog: 'documents:open-attachments-dialog',
  documentsSaveAttachment: 'documents:save-attachment',
  recentList: 'recent:list',
  recentAdd: 'recent:add',
  recentClear: 'recent:clear',
  recoveryList: 'recovery:list',
  recoveryWrite: 'recovery:write',
  recoveryRead: 'recovery:read',
  recoveryRemove: 'recovery:remove',
} as const;

export const APP_PROTOCOL = 'app';
export const APP_HOST = 'bundle';
export const APP_ORIGIN = `${APP_PROTOCOL}://${APP_HOST}`;
