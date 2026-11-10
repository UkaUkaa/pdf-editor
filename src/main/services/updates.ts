import type { UpdateState, UpdateStatus } from '@shared/types/updates';

/** The part of electron-updater this service uses; tests supply a stand-in. */
export interface UpdaterLike {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  on(event: 'checking-for-update' | 'update-not-available', listener: () => void): unknown;
  on(event: 'update-available' | 'update-downloaded', listener: (info: { version: string }) => void): unknown;
  on(event: 'download-progress', listener: (progress: { percent: number }) => void): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
  checkForUpdates(): Promise<unknown>;
  quitAndInstall(): void;
}

export interface UpdateServiceOptions {
  /** `null` when this copy cannot update at all (a development build). */
  updater: UpdaterLike | null;
  currentVersion: string;
  /**
   * Whether an update can be installed without the user downloading it by
   * hand. Not the case on macOS until the application is signed with a
   * Developer ID: the system refuses to replace an unsigned application.
   */
  canSelfInstall: boolean;
  /** The user's "check automatically" preference. */
  isEnabled: () => boolean;
  onState: (state: UpdateState) => void;
  onWarning?: (message: string) => void;
}

export const UPDATE_FIRST_CHECK_DELAY = 15_000;
export const UPDATE_CHECK_INTERVAL = 6 * 60 * 60 * 1000;

/**
 * Looks for new versions and installs them. This is the only part of the
 * application that uses the network, it can be switched off in the
 * preferences, and it sends nothing but ordinary download requests to the
 * release server: no documents, no identifiers, no usage data.
 */
export class UpdateService {
  private state: UpdateState;
  private timers: Array<ReturnType<typeof setTimeout>> = [];
  private checking = false;

  constructor(private readonly options: UpdateServiceOptions) {
    const { updater, canSelfInstall, currentVersion } = options;
    this.state = { status: updater ? 'idle' : 'unavailable', currentVersion, version: null, progress: null };
    if (!updater) return;

    updater.autoDownload = canSelfInstall;
    // A downloaded update is applied when the user quits, even if they never click "restart".
    updater.autoInstallOnAppQuit = canSelfInstall;
    updater.on('checking-for-update', () => this.set('checking'));
    updater.on('update-not-available', () => this.set('upToDate'));
    updater.on('update-available', (info) =>
      this.set(canSelfInstall ? 'downloading' : 'available', { version: info.version, progress: canSelfInstall ? 0 : null }),
    );
    updater.on('download-progress', (progress) =>
      this.set('downloading', { progress: Math.max(0, Math.min(100, Math.round(progress.percent))) }),
    );
    updater.on('update-downloaded', (info) => this.set('ready', { version: info.version, progress: null }));
    updater.on('error', (error) => this.fail(error));
  }

  getState(): UpdateState {
    return this.state;
  }

  private set(status: UpdateStatus, patch: Partial<UpdateState> = {}): void {
    // Once an update is waiting to be installed, later checks must not hide it.
    if (this.state.status === 'ready' && status !== 'ready') return;
    this.state = { ...this.state, ...patch, status };
    this.options.onState(this.state);
  }

  private fail(error: unknown): void {
    this.options.onWarning?.(`Update check failed: ${String(error)}`);
    this.set('error', { progress: null });
  }

  /**
   * Looks for a newer version. Automatic checks respect the preference and
   * stay silent about failures (no network is normal); a check the user asked
   * for always runs and reports what happened.
   */
  async check(manual: boolean): Promise<UpdateState> {
    const { updater } = this.options;
    if (!updater || this.checking || this.state.status === 'downloading' || this.state.status === 'ready') return this.state;
    if (!manual && !this.options.isEnabled()) return this.state;
    this.checking = true;
    const before = this.state;
    try {
      await updater.checkForUpdates();
    } catch (error) {
      if (manual) this.fail(error);
      else {
        this.options.onWarning?.(`Update check failed: ${String(error)}`);
        // Back to how things were: an automatic check that could not reach the server is not news.
        this.state = before.status === 'checking' ? { ...before, status: 'idle' } : before;
        this.options.onState(this.state);
      }
    } finally {
      this.checking = false;
    }
    return this.state;
  }

  /** Restarts into the downloaded update. Returns false when there is nothing to install. */
  install(): boolean {
    if (!this.options.updater || this.state.status !== 'ready') return false;
    this.options.updater.quitAndInstall();
    return true;
  }

  /** Checks shortly after start and then a few times a day. */
  start(): void {
    if (!this.options.updater) return;
    this.timers.push(setTimeout(() => void this.check(false), UPDATE_FIRST_CHECK_DELAY));
    this.timers.push(setInterval(() => void this.check(false), UPDATE_CHECK_INTERVAL));
  }

  stop(): void {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers = [];
  }
}
