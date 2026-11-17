
import {
  DestroyRef,
  Injectable,
  InjectionToken,
  inject,
  isDevMode,
  signal,
} from '@angular/core';
import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import {
  DeviceGpsFix,
  MapsService,
  isUsableCoordinate,
} from './maps.service';
import { DRIVER_GPS_STALE_MS } from './driver-gps.service';
import { getSharedSupabaseClient } from './supabase-client';

export const DRIVER_LOCATION_CLIENT =
  new InjectionToken<ReturnType<typeof getSharedSupabaseClient>>(
    'Driver location client',
    {
      providedIn: 'root',
      factory: () => getSharedSupabaseClient(),
    },
  );

@Injectable({ providedIn: 'root' })
export class DriverLocationPublisherService {
  private readonly destroy = inject(DestroyRef);
  private readonly client = inject(DRIVER_LOCATION_CLIENT);
  private readonly maps = inject(MapsService);

  private readonly status = signal('Location sharing inactive.');
  readonly message = this.status.asReadonly();

  private readonly detail = signal('');
  readonly diagnostic = this.detail.asReadonly();

  // Actual device-reported accuracy; diagnostic only, never relaxes publishing validation.
  private readonly accuracyValue = signal<number | null>(null);
  readonly accuracyMeters = this.accuracyValue.asReadonly();

  readonly accuracyQuality = () => {
    const meters = this.accuracyValue();
    if (meters === null) return 'Waiting for GPS';
    if (meters <= 20) return 'Excellent';
    if (meters <= 50) return 'Good';
    if (meters <= 100) return 'Moderate';
    if (meters <= 200) return 'Low accuracy — not shared';
    return 'Very low accuracy — not shared';
  };


  private trace(message: string): void {
    if (isDevMode()) {
      this.detail.set(message);
    }
  }

  private dashboard = false;
  private nativeActive = !Capacitor.isNativePlatform();
  private optedIn = false;
  private intent = 0;
  private permissionPending = false;
  private generation = 0;
  private starting = false;
  private publishing = false;
  private session?: string;
  private stopWatch?: () => void;
  private stopPermissionWatch?: () => void;
  private lastCapture = 0;
  private expiry?: ReturnType<typeof setTimeout>;
  private lifecycle?: Promise<void>;

  constructor() {
    this.destroy.onDestroy(() => {
      void this.disable();
    });
  }

  setDashboardVisible(visible: boolean): void {
    if (!visible && this.optedIn) {
      this.trace('Run cancelled: Driver Dashboard left.');
    }

    this.dashboard = visible;
    this.refresh();
  }

  onlineIntent(): number {
    return this.intent;
  }

  async optIn(intent: number): Promise<void> {
    if (
      intent !== this.intent ||
      this.permissionPending ||
      this.session
    ) {
      return;
    }

    this.trace('Checking location permission.');
    this.permissionPending = true;
    this.optedIn = true;

    const run = this.generation;

    try {
      await (this.lifecycle ??= this.bindLifecycle());
    } catch {
      if (run === this.generation) {
        this.fail(
          'Location sharing inactive. Check location permission and try Go Online again.',
        );
      }
    } finally {
      this.permissionPending = false;

      if (this.eligible()) {
        this.refresh(run === this.generation);
      }
    }
  }

  async disable(): Promise<void> {
    ++this.intent;
    this.optedIn = false;
    await this.stop();
  }

  private async bindLifecycle(): Promise<void> {
    if (Capacitor.isNativePlatform()) {
      let observed = false;

      const listener = await App.addListener(
        'appStateChange',
        ({ isActive }) => {
          observed = true;

          if (!isActive && this.optedIn) {
            this.trace('Run cancelled: application backgrounded.');
          }

          this.nativeActive = isActive;
          this.refresh();
        },
      );

      if (this.destroy.destroyed) {
        await listener.remove();
        return;
      }

      this.destroy.onDestroy(() => {
        void listener.remove().catch(() => undefined);
      });

      const state = await App.getState();

      if (!observed) {
        this.nativeActive = state.isActive;
      }
    }

    if (this.destroy.destroyed) {
      return;
    }

    const visibilityChanged = () => {
      if (
        document.visibilityState !== 'visible' &&
        this.optedIn
      ) {
        this.trace('Run cancelled: browser document hidden.');
      }

      this.refresh();
    };

    document.addEventListener(
      'visibilitychange',
      visibilityChanged,
    );

    this.destroy.onDestroy(() => {
      document.removeEventListener(
        'visibilitychange',
        visibilityChanged,
      );
    });
  }

  private eligible(): boolean {
    return (
      this.optedIn &&
      this.dashboard &&
      this.nativeActive &&
      document.visibilityState === 'visible'
    );
  }

  private refresh(allowPrompt = false): void {
    if (!this.eligible()) {
      void this.stop();
    } else if (
      !this.permissionPending &&
      !this.starting &&
      !this.session
    ) {
      void this.start(allowPrompt);
    }
  }

  private async readPermission(): Promise<
    PermissionStatus | undefined
  > {
    let timer: ReturnType<typeof setTimeout> | undefined;

    try {
      return await Promise.race([
        navigator.permissions?.query({
          name: 'geolocation',
        }),
        new Promise<undefined>((resolve) => {
          timer = setTimeout(resolve, 1000);
        }),
      ]);
    } catch {
      return undefined;
    } finally {
      clearTimeout(timer);
    }
  }

  private async start(allowPrompt: boolean): Promise<void> {
    this.starting = true;

    const run = this.generation;
    const current = () =>
      run === this.generation && this.eligible();

    try {
      this.trace('Checking location permission.');

      const permission = await this.readPermission();

      if (!current()) {
        return;
      }

      if (
        permission?.state === 'denied' ||
        (permission?.state === 'prompt' && !allowPrompt)
      ) {
        this.trace('Location permission is not granted.');

        this.fail(
          'Location sharing inactive. Allow location access and try Go Online again.',
        );

        return;
      }

      let initialFix: DeviceGpsFix | undefined;

      if (permission?.state !== 'granted') {
        this.trace('Requesting a first browser location fix.');

        try {
          initialFix = await this.maps.currentPosition();
        } catch {
          if (current()) {
            this.trace('First browser location request failed.');

            this.fail(
              'Location sharing inactive. Check location permission and try Go Online again.',
            );
          }

          return;
        }

        if (!current()) {
          return;
        }

        if (
          (permission as PermissionStatus | undefined)?.state ===
          'denied'
        ) {
          this.fail(
            'Location sharing inactive. Location permission was lost.',
          );

          return;
        }
      }

      if (permission) {
        const changed = () => {
          if (
            current() &&
            permission.state !== 'granted'
          ) {
            this.fail(
              'Location sharing inactive. Location permission was lost.',
            );
          }
        };

        permission.addEventListener('change', changed);

        this.stopPermissionWatch = () => {
          permission.removeEventListener('change', changed);
        };
      }

      this.trace('Opening a GPS session.');

      const { data, error } = await this.client.rpc(
        'begin_driver_location_session',
      );

      if (
        error ||
        typeof data !== 'string' ||
        !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(
          data,
        )
      ) {
        throw new Error();
      }

      if (!current()) {
        await this.clear(data);
        return;
      }

      this.trace(
        'Session opened. Waiting for a valid browser fix.',
      );

      this.session = data;
      this.lastCapture = 0;

      this.status.set(
        'Location sharing inactive. Waiting for a fresh, accurate GPS fix.',
      );

      if (initialFix) {
        void this.publish(initialFix, run, 'FIRST_FIX');
      }

      const stop = this.maps.watchDeviceGps(
        (fix) => {
          if (current()) {
            void this.publish(fix, run, 'WATCH');
          }
        },
        (_message, denied) => {
          if (!current()) {
            return;
          }

          this.trace(
            denied
              ? 'Browser GPS watch reported permission denied.'
              : 'Browser GPS watch reported an error before the next fix.',
          );

          this.fail(
            'Location sharing inactive. GPS is unavailable.',
          );
        },
      );

      if (current()) {
        this.stopWatch = stop;

        if (allowPrompt && !initialFix) {
          void this.publishStartupFix(run);
        }
      } else {
        stop();
      }
    } catch {
      if (current()) {
        this.trace('GPS startup failed.');

        this.fail(
          'Location sharing inactive. Could not start a GPS session.',
        );
      }
    } finally {
      this.starting = false;

      if (
        run !== this.generation &&
        this.eligible()
      ) {
        this.refresh();
      }
    }
  }

  private async publishStartupFix(run: number): Promise<void> {
    let fix: DeviceGpsFix;

    try {
      fix = await this.maps.currentPosition();
    } catch {
      // The watch is already running and can still provide a usable fix.
      return;
    }

    await this.publish(fix, run, 'FIRST_FIX');
  }

  private async publish(
    fix: DeviceGpsFix,
    run: number,
    source: 'FIRST_FIX' | 'WATCH',
  ): Promise<void> {
    if (
      run !== this.generation ||
      !this.eligible() ||
      this.publishing ||
      !this.session
    ) {
      return;
    }

    const accuracy = fix.accuracyMeters;
    this.accuracyValue.set(
      accuracy !== null && Number.isFinite(accuracy) && accuracy >= 0
        ? accuracy
        : null,
    );
    const timestamp = fix.capturedAt;
    const capture = timestamp ? Date.parse(timestamp) : NaN;
    const now = Date.now();

    let rejection: string | undefined;

    if (!isUsableCoordinate(fix.latitude, fix.longitude)) {
      rejection = 'INVALID_COORDINATES';
    } else if (accuracy == null) {
      rejection = fix.accuracyNonfinite
        ? `${source}_ACCURACY_NONFINITE`
        : `${source}_ACCURACY_MISSING`;
    } else if (!Number.isFinite(accuracy)) {
      rejection = `${source}_ACCURACY_NONFINITE`;
    } else if (accuracy < 0) {
      rejection = `${source}_ACCURACY_NEGATIVE`;
    } else if (accuracy > 100) {
      rejection = `${source}_ACCURACY_OVER_LIMIT`;
    } else if (!Number.isFinite(capture)) {
      rejection = 'MISSING_TIMESTAMP';
    } else if (capture > now) {
      rejection = 'FUTURE_TIMESTAMP';
    } else if (now - capture > DRIVER_GPS_STALE_MS) {
      rejection = 'STALE_TIMESTAMP';
    }

    if (rejection) {
      this.trace(rejection);

      if (this.status() !== 'Location sharing active.') {
        this.status.set(
          'Location sharing inactive. Waiting for a fresh, accurate GPS fix.',
        );
      }

      return;
    }

    if (capture <= this.lastCapture) {
      return;
    }

    this.lastCapture = capture;
    this.trace('Sending a validated fix.');
    this.publishing = true;

    try {
      const { error } = await this.client.rpc(
        'publish_driver_location',
        {
          p_session_id: this.session,
          p_latitude: fix.latitude,
          p_longitude: fix.longitude,
          p_accuracy_m: accuracy,
          p_captured_at: timestamp,
        },
      );

      if (error) {
        throw new Error();
      }

      if (run === this.generation) {
        this.trace('Publish accepted.');
        clearTimeout(this.expiry);

        const remaining =
          capture + DRIVER_GPS_STALE_MS - Date.now();

        if (remaining > 0) {
          this.status.set('Location sharing active.');

          this.expiry = setTimeout(() => {
            this.status.set(
              'Location sharing inactive. Waiting for a fresh, accurate GPS fix.',
            );
          }, remaining);
        } else {
          this.status.set(
            'Location sharing inactive. GPS fix expired.',
          );
        }
      }
    } catch {
      if (run === this.generation) {
        this.trace('Publish RPC failed.');

        this.fail(
          'Location sharing inactive. Could not publish GPS.',
        );
      }
    } finally {
      this.publishing = false;
    }
  }

  private fail(message: string): void {
    void this.disable();
    this.status.set(message);
  }

  private async stop(): Promise<void> {
    ++this.generation;

    clearTimeout(this.expiry);

    this.stopWatch?.();
    this.stopWatch = undefined;

    this.stopPermissionWatch?.();
    this.stopPermissionWatch = undefined;

    const session = this.session;
    this.session = undefined;

    this.accuracyValue.set(null);
    this.status.set('Location sharing inactive.');

    if (session) {
      await this.clear(session);
    }
  }

  private async clear(session: string): Promise<void> {
    const timeout = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;

    const deadline = new Promise<void>((resolve) => {
      timer = setTimeout(() => {
        timeout.abort();
        resolve();
      }, 1500);
    });

    try {
      await Promise.race([
        deadline,
        this.client
          .rpc('clear_driver_location', {
            p_session_id: session,
          })
          .abortSignal(timeout.signal),
      ]);
    } catch {
      // Server expiry bounds visibility if cleanup cannot reach the server.
    } finally {
      clearTimeout(timer);
    }
  }
}
