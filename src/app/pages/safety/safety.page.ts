import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { IonIcon } from '@ionic/angular';

import { AppNavigationComponent } from '../../shared/app-navigation.component';
import { LocalRide } from '../../core/models/local-ride.model';
import { LocalRideService } from '../../core/services/local-ride.service';
import { RideService } from '../../core/services/ride.service';

@Component({
  selector: 'app-safety',
  standalone: true,

  imports: [
    CommonModule,
    RouterLink,
    IonIcon,
    AppNavigationComponent
  ],

  templateUrl: './safety.page.html',
  styleUrls: ['./safety.page.scss']
})
export class SafetyPage {

  currentRide: LocalRide | null = null;


  constructor(
    private router: Router,
    private localRides: LocalRideService,
    private ridesApi: RideService,
  ) {}


  // =========================
  // LOAD CURRENT RIDE
  // =========================

  ionViewWillEnter(): void {
    void this.ridesApi.hydrateFromCloud()
      .catch(() => undefined)
      .finally(() => {
        this.currentRide = this.localRides.getUpcomingRide();
      });
  }

  statusTone(ride: LocalRide): string {
    return this.localRides.statusTone(ride.status);
  }


  // =========================
  // EMERGENCY HELP
  // =========================

  emergencyHelp(): void {

    const confirmed = confirm(
      'Emergency Help\n\n' +
      'If you are in immediate danger or need urgent assistance, you can call 911.\n\n' +
      'Do you want to open your device dialer for 911?'
    );

    if (!confirmed) {
      return;
    }

    window.location.href = 'tel:911';

  }


  // =========================
  // CALL RIDE EMERGENCY CONTACT
  // =========================

  callEmergencyContact(): void {

    if (!this.currentRide) {

      alert(
        'There is no active or upcoming ride available.'
      );

      return;

    }


    const phoneNumber =
      this.currentRide.emergencyContactNumber?.trim();


    if (!phoneNumber) {

      alert(
        'No emergency contact number is saved for this ride.'
      );

      return;

    }


    const confirmed = confirm(
      'Call Emergency Contact?\n\n' +
      this.currentRide.emergencyContactName +
      '\n' +
      phoneNumber
    );


    if (!confirmed) {
      return;
    }


    window.location.href =
      `tel:${phoneNumber}`;

  }


  // =========================
  // VIEW CURRENT RIDE
  // =========================

  viewCurrentRide(): void {

    if (
      !this.currentRide ||
      !this.currentRide.id
    ) {

      alert(
        'You currently have no active or upcoming ride.'
      );

      return;

    }


    this.router.navigate(['/ride-details', this.currentRide.id], {
      state: { ride: this.currentRide },
    });

  }


  // =========================
  // REPORT SAFETY CONCERN
  // =========================

  reportSafetyConcern(): void {

    if (!this.currentRide) {

      alert(
        'There is no active ride associated with a safety report yet.\n\n' +
        'When CareRide is connected to the backend, reports can be stored and reviewed by the administrator.'
      );

      return;

    }


    const concern = prompt(
      'Report a Safety Concern\n\n' +
      'Briefly describe what happened during your ride:'
    );


    if (concern === null) {
      return;
    }


    const cleanConcern =
      concern.trim();


    if (!cleanConcern) {

      alert(
        'Please enter a description of the safety concern.'
      );

      return;

    }


    void this.ridesApi.reportIssue(this.currentRide.id, cleanConcern)
      .then(() => {
        alert(
          'Safety concern recorded.\n\n' +
          'Ride ID: ' +
          this.currentRide!.id +
          '\n\n' +
          'Report:\n' +
          cleanConcern
        );
      })
      .catch((error: unknown) => {
        alert(error instanceof Error ? error.message : 'Unable to save the safety report.');
      });
  }


  // =========================
  // MANAGE PROFILE
  // =========================

  manageProfile(): void {

    this.router.navigate([
      '/profile'
    ]);

  }

}