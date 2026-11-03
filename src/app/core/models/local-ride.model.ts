export type LocalRideStatus =
  | 'Pending'
  | 'Scheduled'
  | 'Driver Assigned'
  | 'Driver On The Way'
  | 'Arrived'
  | 'Picked Up'
  | 'In Progress'
  | 'Completed'
  | 'Cancelled'
  | 'Rejected'
  | 'Reported';

export type LocalPassengerType = 'self' | 'family';

export interface LocalRide {
  id: string;
  passengerType: LocalPassengerType;
  passengerName: string;
  pickupLocation: string;
  destination: string;
  purpose: string;
  date: string;
  time: string;
  assistance: string[];
  otherAssistanceNotes: string;
  notes: string;
  emergencyContactName: string;
  emergencyContactNumber: string;
  pickupLatitude: number | null;
  pickupLongitude: number | null;
  destinationLatitude: number | null;
  destinationLongitude: number | null;
  pickupAccuracyMeters?: number | null;
  destinationAccuracyMeters?: number | null;
  driverId?: string | null;
  driverName?: string | null;
  driverPhone?: string | null;
  vehicleLabel?: string | null;
  driverRating?: number | null;
  preferredDriverId?: string | null;
  preferredDriverName?: string | null;
  preferredDriverPhone?: string | null;
  preferredVehicleLabel?: string | null;
  preferredDriverRating?: number | null;
  clientRating?: number | null;
  clientComment?: string | null;
  ratedAt?: string | null;
  ratedByPassengerId?: string | null;
  referralStatus?: 'pending' | 'accepted_by_replacement' | 'passenger_confirmed' | 'passenger_declined';
  referralOriginalDriverId?: string | null;
  referralProposedDriverId?: string | null;
  referralProposedDriverName?: string | null;
  status: LocalRideStatus;
  createdAt: string;
  updatedAt: string;
}

export interface CreateLocalRideInput {
  passengerType: LocalPassengerType;
  passengerName: string;
  pickupLocation: string;
  destination: string;
  purpose: string;
  date: string;
  time: string;
  assistance: string[];
  otherAssistanceNotes: string;
  notes: string;
  emergencyContactName: string;
  emergencyContactNumber: string;
  pickupLatitude?: number | null;
  pickupLongitude?: number | null;
  destinationLatitude?: number | null;
  destinationLongitude?: number | null;
  pickupAccuracyMeters?: number | null;
  destinationAccuracyMeters?: number | null;
  preferredDriverId?: string | null;
  preferredDriverName?: string | null;
  preferredDriverPhone?: string | null;
  preferredVehicleLabel?: string | null;
  preferredDriverRating?: number | null;
  status?: LocalRideStatus;
}

export interface LocalDriverOption {
  driverId: string;
  driverName: string;
  driverPhone: string;
  vehicleId: string;
  vehicleLabel: string;
  rating: number;
  ratingCount: number;
  available: boolean;
}

export const ACTIVE_RIDE_STATUSES: LocalRideStatus[] = [
  'Pending',
  'Scheduled',
  'Driver Assigned',
  'Driver On The Way',
  'Arrived',
  'Picked Up',
  'In Progress',
];

export const DRIVER_QUEUE_STATUSES: LocalRideStatus[] = [
  'Driver Assigned',
  'Driver On The Way',
  'Arrived',
  'Picked Up',
  'In Progress',
];

export const CANCELLABLE_RIDE_STATUSES: LocalRideStatus[] = [
  'Pending',
  'Scheduled',
  'Driver Assigned',
];
