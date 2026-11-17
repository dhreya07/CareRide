import { Component, DestroyRef, OnInit, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { IonIcon } from '@ionic/angular';
import { AccountRole, normalizeAccountRole } from '../../core/models/care-ride.models';
import { AuthService } from '../../core/services/auth.service';
import { InAppNotification, NotificationService } from '../../core/services/notification.service';
import { AppNavigationComponent } from '../../shared/app-navigation.component';
import { DriverNavigationComponent } from '../../shared/driver-navigation.component';

@Component({
  selector: 'app-notifications',
  standalone: true,
  host: { class: 'ion-page' },
  imports: [CommonModule, RouterLink, IonIcon, AppNavigationComponent, DriverNavigationComponent],
  templateUrl: './notifications.page.html',
  styleUrls: ['./notifications.page.scss'],
})
export class NotificationsPage implements OnInit {
  filter: 'all' | 'unread' = 'all';
  items: InAppNotification[] = [];
  unreadCount = 0;
  private cloudRole: AccountRole | null = null;
  private readonly destroyRef = inject(DestroyRef);

  constructor(
    private notifications: NotificationService,
    private auth: AuthService,
    private router: Router,
  ) {}

  ngOnInit(): void {
    this.notifications.changes$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.load());
  }

  ionViewWillEnter(): void {
    void this.refreshCloudNotifications();
  }

  get isDriver(): boolean {
    if (this.auth.cloudAuthEnabled) {
      return this.cloudRole === 'driver';
    }
    const account = this.auth.getLocalAccount();
    return Boolean(account && normalizeAccountRole(account.accountType) === 'driver');
  }

  get homePath(): string {
    return this.isDriver ? '/driver' : '/dashboard';
  }

  selectFilter(filter: 'all' | 'unread'): void {
    this.filter = filter;
    this.load();
  }

  markRead(item: InAppNotification): void {
    if (this.auth.cloudAuthEnabled) {
      void this.notifications.markRead(item.id, '').then(() => this.load()).catch(() => undefined);
      return;
    }
    const account = this.auth.getLocalAccount();
    if (!account) {
      return;
    }
    this.notifications.markRead(item.id, account.id);
  }

  markAllRead(): void {
    if (this.auth.cloudAuthEnabled) {
      void this.notifications.markAllRead('').then(() => this.load()).catch(() => undefined);
      return;
    }
    const account = this.auth.getLocalAccount();
    if (!account) {
      return;
    }
    this.notifications.markAllRead(account.id);
  }

  openNotification(item: InAppNotification): void {
    this.markRead(item);
    if (!item.rideId) {
      return;
    }
    if (item.type === 'referral_confirmation_needed' && !this.isDriver) {
      void this.router.navigate(['/dashboard']);
      return;
    }
    void this.router.navigate(['/ride-details', item.rideId]);
  }

  formatWhen(value: string): string {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return value;
    }
    return parsed.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  }

  private load(): void {
    if (this.auth.cloudAuthEnabled) {
      const cloudItems = this.notifications.listFor('');
      this.unreadCount = cloudItems.filter((item) => !item.read).length;
      this.items = this.filter === 'unread' ? cloudItems.filter((item) => !item.read) : cloudItems;
      return;
    }
    const account = this.auth.getLocalAccount();
    const all = account ? this.notifications.listFor(account.id) : [];
    this.unreadCount = all.filter((item) => !item.read).length;
    this.items = this.filter === 'unread' ? all.filter((item) => !item.read) : all;
  }

  private async refreshCloudNotifications(): Promise<void> {
    if (this.auth.cloudAuthEnabled) {
      this.cloudRole = await this.auth.getCurrentRole().catch(() => null);
    }
    await this.notifications.refreshCloud().catch(() => undefined);
    this.load();
  }
}
