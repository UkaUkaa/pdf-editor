/**
 * Where the application is in looking for a newer version.
 *
 * - `unavailable`: this copy cannot update (it is not an installed build).
 * - `available`: a newer version exists, but this platform cannot install it by
 *   itself; the user is pointed to the download page.
 * - `ready`: the update is downloaded and will be installed on restart.
 */
export const UPDATE_STATUSES = ['idle', 'unavailable', 'checking', 'upToDate', 'available', 'downloading', 'ready', 'error'] as const;
export type UpdateStatus = (typeof UPDATE_STATUSES)[number];

export interface UpdateState {
  status: UpdateStatus;
  /** Version running now. */
  currentVersion: string;
  /** The newer version, once one has been found. */
  version: string | null;
  /** Download progress, 0…100, while downloading. */
  progress: number | null;
}
