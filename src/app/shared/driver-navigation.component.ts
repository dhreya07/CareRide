
import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { IonIcon } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { personCircleOutline } from 'ionicons/icons';

@Component({
  selector: 'app-driver-navigation',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, IonIcon],
  template: `
    <nav class="bottom-nav" aria-label="Driver navigation">

      <a
        routerLink="/driver"
        routerLinkActive="active"
        ariaCurrentWhenActive="page"
        [routerLinkActiveOptions]="{ exact: true }"
        aria-label="Home">
        <ion-icon name="home-outline"></ion-icon>
        <small>Home</small>
      </a>

      <a
        routerLink="/driver/schedule"
        routerLinkActive="active"
        ariaCurrentWhenActive="page"
        aria-label="My schedule">
        <ion-icon name="calendar-outline"></ion-icon>
        <small>Schedule</small>
      </a>

      <a
        class="nav-primary"
        routerLink="/driver/active"
        routerLinkActive="active"
        ariaCurrentWhenActive="page"
        aria-label="Active Client">
        <ion-icon name="car-outline"></ion-icon>
        <small>Active Client</small>
      </a>

      <a
        routerLink="/driver/history"
        routerLinkActive="active"
        ariaCurrentWhenActive="page"
        aria-label="History">
        <ion-icon name="time-outline"></ion-icon>
        <small>History</small>
      </a>

      <a
        routerLink="/driver/profile"
        routerLinkActive="active"
        ariaCurrentWhenActive="page"
        aria-label="Profile">
        <ion-icon name="person-circle-outline"></ion-icon>
        <small>Profile</small>
      </a>

    </nav>
  `,
  styles: [`

    :host {
      display: block;
      flex-shrink: 0;
      width: 100%;
    }

    .bottom-nav {
      position: relative;
      z-index: 20;
      width: 100%;
      min-height: 82px;

      display: flex;
      align-items: center;
      justify-content: space-around;

      padding: 8px 8px
        max(12px, env(safe-area-inset-bottom));

      background: linear-gradient(
        180deg,
        #07443c 0%,
        #032c29 100%
      );

      border-top: 1px solid rgba(190, 255, 226, 0.16);

      box-shadow: 0 -8px 26px rgba(0, 25, 23, 0.20);
      box-sizing: border-box;
    }

    .bottom-nav a {
      flex: 1;
      min-width: 0;
      min-height: 62px;

      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;

      gap: 5px;
      padding: 3px 1px;

      border-radius: 14px;
      color: #b9d8ce;
      text-decoration: none;

      -webkit-tap-highlight-color: transparent;
    }

    .bottom-nav ion-icon {
      width: 23px;
      height: 23px;
      font-size: 23px;

      padding: 7px 11px;
      border-radius: 13px;

      background: transparent;
      color: #d1f2e7;

      box-sizing: content-box;

      transition:
        background 0.2s ease,
        color 0.2s ease,
        transform 0.2s ease;
    }

    .bottom-nav small {
      max-width: 78px;
      color: #c0dcd3;

      font-size: 11px;
      font-weight: 700;
      line-height: 1.2;

      text-align: center;
      white-space: normal;
    }

    /* ACTIVE TAB */

    .bottom-nav a.active ion-icon {
      color: #06483d;

      background: linear-gradient(
        135deg,
        #d5ffe9 0%,
        #9aebce 100%
      );

      box-shadow: 0 4px 14px rgba(25, 220, 158, 0.20);

      transform: translateY(-1px);
    }

    .bottom-nav a.active small {
      color: #ffffff;
      font-weight: 850;
    }

    /* HOVER */

    .bottom-nav a:not(.active):hover ion-icon {
      background: rgba(196, 255, 228, 0.13);
    }

    .bottom-nav a:focus-visible {
      outline: 2px solid #baf5d9;
      outline-offset: -2px;
    }

    /* SMALL PHONES */

    @media (max-width: 380px) {

      .bottom-nav {
        padding-left: 3px;
        padding-right: 3px;
      }

      .bottom-nav ion-icon {
        width: 21px;
        height: 21px;
        padding: 7px 9px;
      }

      .bottom-nav small {
        font-size: 10px;
      }

    }

    @media (prefers-reduced-motion: reduce) {
      .bottom-nav ion-icon {
        transition: none;
      }
    }

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
export class DriverNavigationComponent {
  constructor() {
    addIcons({ personCircleOutline });
  }
}
