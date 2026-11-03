import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { IonIcon } from '@ionic/angular';

@Component({
  selector: 'app-admin-navigation',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, IonIcon],
  template: `
    <nav class="bottom-nav" aria-label="Admin navigation">
      <a routerLink="/admin" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }" aria-label="Operations">
        <ion-icon name="home-outline"></ion-icon>
        <small>Home</small>
      </a>
      <a routerLink="/admin/accounts" routerLinkActive="active" aria-label="Accounts waiting for approval">
        <ion-icon name="person-outline"></ion-icon>
        <small>Accounts</small>
      </a>
      <a routerLink="/admin/accepted" routerLinkActive="active" aria-label="Accepted requests">
        <ion-icon name="checkmark-outline"></ion-icon>
        <small>Accepted</small>
      </a>
      <a routerLink="/admin/history" routerLinkActive="active" aria-label="History">
        <ion-icon name="time-outline"></ion-icon>
        <small>History</small>
      </a>
      <a routerLink="/admin/drivers" routerLinkActive="active" aria-label="Available drivers">
        <ion-icon name="people-outline"></ion-icon>
        <small>Drivers</small>
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
export class AdminNavigationComponent {}
