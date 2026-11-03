import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { IonIcon } from '@ionic/angular';

@Component({
  selector: 'app-driver-navigation',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, IonIcon],
  template: `
    <nav class="bottom-nav" aria-label="Driver navigation">
      <a routerLink="/driver" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }" aria-label="Overview">
        <ion-icon name="home-outline"></ion-icon>
        <small>Home</small>
      </a>
      <a routerLink="/driver/schedule" routerLinkActive="active" aria-label="My schedule">
        <ion-icon name="calendar-outline"></ion-icon>
        <small>Schedule</small>
      </a>
      <a routerLink="/driver/active" routerLinkActive="active" aria-label="Active trips">
        <ion-icon name="car-outline"></ion-icon>
        <small>Active</small>
      </a>
      <a routerLink="/driver/clients" routerLinkActive="active" aria-label="Past clients">
        <ion-icon name="people-outline"></ion-icon>
        <small>Clients</small>
      </a>
      <a routerLink="/driver/history" routerLinkActive="active" aria-label="History">
        <ion-icon name="time-outline"></ion-icon>
        <small>History</small>
      </a>
    </nav>
  `,
  styles: [`
    :host { display: block; flex-shrink: 0; width: 100%; }
    .bottom-nav {
      position: relative;
      z-index: 20;
      width: 100%;
      min-height: 76px;
      padding: 10px 8px max(12px, env(safe-area-inset-bottom));
      display: flex;
      justify-content: space-around;
      align-items: center;
      background: #CCD0CF;
      border-top: 1px solid #9BA8AB;
    }
    .bottom-nav a {
      color: #4A5C6A;
      text-decoration: none;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 3px;
      min-width: 56px;
      min-height: 52px;
    }
    .bottom-nav ion-icon { font-size: 22px; }
    .bottom-nav small { font-size: 11px; font-weight: 750; white-space: nowrap; }
    .bottom-nav a.active { color: #06141B; }
  `],
})
export class DriverNavigationComponent {}
