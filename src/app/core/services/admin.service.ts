import { Injectable } from '@angular/core';
import { environment } from '../../../environments/environment';
import { SupabaseBookingAdapter } from './supabase-booking.adapter';

export interface PendingRide {
  id: string;
  pickupAddress: string;
  destinationAddress: string;
  scheduledAt: string;
  assistanceNeeds: string[];
}

export interface AvailableDriver {
  id: string;
  name: string;
  phone: string;
  vehicles: Array<{ id: string; make: string; model: string; plateNumber: string }>;
}

@Injectable({ providedIn: 'root' })
export class AdminService {
  constructor(private bookings: SupabaseBookingAdapter) {}

  async getAssignmentQueue(): Promise<{ rides: PendingRide[]; drivers: AvailableDriver[] }> {
    this.requireCloudBookings();
    const rides = (await this.bookings.listBookings())
      .filter((ride) => ride.status === 'Pending' || ride.status === 'Scheduled')
      .map((ride) => ({
        id: ride.id,
        pickupAddress: ride.pickupLocation,
        destinationAddress: ride.destination,
        scheduledAt: `${ride.date}T${ride.time}`,
        assistanceNeeds: ride.assistance,
      }));
    const drivers = (await this.bookings.listAvailableDrivers()).map((driver) => ({
      id: driver.id,
      name: driver.name,
      phone: driver.phone,
      vehicles: [{
        id: driver.id,
        make: driver.vehicleType,
        model: '',
        plateNumber: driver.plateNumber,
      }],
    }));
    return { rides, drivers };
  }

  async assign(rideId: string, driverId: string, _vehicleId: string): Promise<void> {
    this.requireCloudBookings();
    await this.bookings.assignBooking(rideId, driverId);
  }

  private requireCloudBookings(): void {
    if (environment.supabase.cloudMigration !== true) {
      throw new Error('Admin data is unavailable until Supabase is configured.');
    }
  }
}
