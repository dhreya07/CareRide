import { Component } from '@angular/core';
import {
  RouterLink,
  RouterLinkActive
} from '@angular/router';
import { IonIcon } from '@ionic/angular';
import { addIcons } from 'ionicons';
import {
  addOutline,
  calendarOutline,
  homeOutline,
  personOutline,
  timeOutline,
} from 'ionicons/icons';

@Component({
  selector: 'app-navigation',
  standalone: true,

  imports: [
    RouterLink,
    RouterLinkActive,
    IonIcon
  ],

  template: `
    <nav
      class="bottom-nav"
      aria-label="Main navigation"
    >

      <!-- HOME -->
      <a
        routerLink="/dashboard"
        routerLinkActive="active"
        [routerLinkActiveOptions]="{ exact: true }"
        aria-label="Home"
      >
        <ion-icon name="home-outline"></ion-icon>
        <small>Home</small>
      </a>


      <!-- SCHEDULED RIDES -->
      <a
        routerLink="/scheduled-rides"
        routerLinkActive="active"
        aria-label="Scheduled rides"
      >
        <ion-icon name="calendar-outline"></ion-icon>
        <small>Scheduled</small>
      </a>


      <!-- REQUEST RIDE -->
      <a
        routerLink="/request-ride"
        routerLinkActive="request-active"
        class="nav-request"
        aria-label="Request a ride"
        title="Request a Ride"
      >
        <ion-icon name="add-outline"></ion-icon>
      </a>


      <!-- RIDE HISTORY -->
      <a
        routerLink="/ride-history"
        routerLinkActive="active"
        aria-label="Ride history"
      >
        <ion-icon name="time-outline"></ion-icon>
        <small>History</small>
      </a>


      <!-- PROFILE -->
      <a
        routerLink="/profile"
        routerLinkActive="active"
        aria-label="Profile"
      >
        <ion-icon name="person-outline"></ion-icon>
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

      min-height: 76px;

      padding:
        10px 10px
        max(12px, env(safe-area-inset-bottom));

      display: flex;
      justify-content: space-around;
      align-items: center;

      background: #CCD0CF;

      border-top:
        1px solid #9BA8AB;
    }


    /* NORMAL NAV BUTTON */

    .bottom-nav a {
      color: #4A5C6A;

      text-decoration: none;

      display: flex;
      flex-direction: column;

      align-items: center;
      justify-content: center;

      gap: 3px;

      min-width: 58px;
      min-height: 52px;

      transition:
        color 0.2s ease,
        transform 0.2s ease;
    }


    .bottom-nav ion-icon {
      font-size: 22px;
    }


    .bottom-nav small {
      font-size: 12px;
      font-weight: 750;

      white-space: nowrap;
    }


    /* ACTIVE PAGE */

    .bottom-nav a.active {
      color: #06141B;
    }


    .bottom-nav a.active ion-icon {
      transform: translateY(-1px);
    }


    /* CENTER REQUEST BUTTON */

    .bottom-nav .nav-request {
      width: 52px;
      height: 52px;

      min-width: 52px;
      min-height: 52px;

      border-radius: 16px;

      background: #11212D;
      color: #ffffff;

      box-shadow:
        0 4px 12px
        rgba(6, 20, 27, 0.22);

      transform: none;
    }


    .bottom-nav .nav-request ion-icon {
      font-size: 28px;
    }


    .bottom-nav .nav-request:hover {
      transform: none;
    }


    /* ACTIVE REQUEST PAGE */

    .bottom-nav .nav-request.request-active {
      box-shadow:
        0 0 0 4px
        rgba(74, 92, 106, 0.28),
        0 7px 18px
        rgba(6, 20, 27, 0.30);
    }


    /* SMALL PHONE */

    @media (max-width: 420px) {

      .bottom-nav {
        padding-left: 7px;
        padding-right: 7px;
      }

      .bottom-nav a {
        min-width: 48px;
      }

      .bottom-nav small {
        font-size: 12px;
      }

      .bottom-nav .nav-request {
        width: 52px;
        height: 52px;

        min-width: 52px;
        min-height: 52px;
      }

    }

  `]
})

export class AppNavigationComponent {
  constructor() {
    addIcons({
      addOutline,
      calendarOutline,
      homeOutline,
      personOutline,
      timeOutline,
    });
  }
}