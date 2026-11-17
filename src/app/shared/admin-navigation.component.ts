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
      <a class="nav-primary" routerLink="/admin/accepted" routerLinkActive="active" aria-label="Accepted requests">
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
    :host .bottom-nav {
      box-sizing: border-box;
      width: min(calc(100% - 12px), 760px);
      min-height: 64px;
      margin: 0 auto max(5px, env(safe-area-inset-bottom));
      padding: 5px 4px 6px;
      display: grid;
      grid-template-columns: repeat(5, minmax(0, 1fr));
      justify-items: center;
      border: 1px solid #f8ffff;
      border-radius: 20px 20px 26px 26px;
      background: linear-gradient(145deg, rgba(248, 255, 255, .78), rgba(201, 240, 243, .54));
      -webkit-backdrop-filter: blur(12px) saturate(150%);
      backdrop-filter: blur(12px) saturate(150%);
      box-shadow: 0 5px 16px #07586032;
    }
    :host .bottom-nav a {
      width: 100%; min-width: 0; min-height: 48px; color: #184a53; border-radius: 16px;
    }
    :host .bottom-nav a ion-icon { padding: 0; color: inherit; background: none; box-shadow: none; }
    :host .bottom-nav small { color: inherit; font-size: clamp(9px, 2.55vw, 12px); white-space: nowrap; }
    :host .bottom-nav a.active {
      color: #043e42;
      background: linear-gradient(145deg, #c5fff2, #78e9dc);
      box-shadow: inset 0 0 0 1px #eafffc, 0 4px 9px #16847830;
    }
    :host .bottom-nav a.active :is(ion-icon, small) { color: inherit; background: none; box-shadow: none; }
    :host .bottom-nav a:focus-visible { outline: 2px solid #08776e; outline-offset: -2px; }
    :host .bottom-nav .nav-primary {
      align-self: start;
      width: 51px;
      height: 51px;
      min-height: 51px;
      margin-top: -18px;
      border: 5px solid #bdfbf1;
      border-radius: 50%;
      color: #f9fff0;
      background: linear-gradient(145deg, #006c64, #04383d);
      box-shadow: 0 4px 11px #08756b60;
    }
    :host .bottom-nav .nav-primary ion-icon { font-size: 25px; }
    :host .bottom-nav .nav-primary small { display: none; }
    :host .bottom-nav .nav-primary.active {
      color: #f9fff0;
      background: linear-gradient(145deg, #006c64, #04383d);
      box-shadow: 0 0 0 2px #e0f6fb, 0 4px 11px #080c0673;
    }
  `],
})
export class AdminNavigationComponent {}
