export type AccountRole = 'passenger' | 'driver' | 'admin';
export type PassengerType = 'elderly' | 'pwd' | 'other';
export type AssistanceNeed = 'wheelchair' | 'walking' | 'visual' | 'hearing' | 'companion' | 'other';
export type RideStatus =
  | 'pending'
  | 'assigned'
  | 'accepted'
  | 'on_the_way'
  | 'arrived'
  | 'picked_up'
  | 'in_transit'
  | 'completed'
  | 'cancelled'
  | 'rejected'
  | 'reported';

export interface Profile {
  id: string;
  fullName: string;
  email: string;
  phone: string | null;
  role: AccountRole;
  createdAt: string;
  updatedAt: string;
}
export interface PassengerProfile {
  id: string;
  profileId: string;
  passengerType: PassengerType;
  address: string | null;
  assistanceNeeds: AssistanceNeed[];
  assistanceNotes: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface RideRequest {
  id: string;
  requestedBy: string;
  passengerId: string;
  pickupAddress: string;
  pickupLatitude: number | null;
  pickupLongitude: number | null;
  destinationAddress: string;
  destinationLatitude: number | null;
  destinationLongitude: number | null;
  scheduledAt: string;
  status: RideStatus;
  assistanceNeeds: AssistanceNeed[];
  notes: string | null;
  driverId: string | null;
  preferredDriverId?: string | null;
  vehicleId: string | null;
  driverName: string | null;
  driverPhone: string | null;
  vehicleLabel: string | null;
  passengerName: string | null;
  passengerBookingType: 'self' | 'family' | null;
  bookingType: 'now' | 'schedule' | null;
  purpose: string | null;
  emergencyContactName: string | null;
  emergencyContactNumber: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface RideStatusEvent {
  id: string;
  rideRequestId: string;
  status: RideStatus;
  changedBy: string | null;
  note: string | null;
  createdAt: string;
}
export interface EmergencyContact {
  id: string;
  profileId: string;
  fullName: string;
  phone: string;
  relationship: string | null;
}
export interface Vehicle {
  id: string;
  driverId: string;
  make: string;
  model: string;
  plateNumber: string;
  accessibilityNotes: string | null;
}
export interface Incident {
  id: string;
  rideRequestId: string | null;
  reportedBy: string;
  category: string;
  description: string;
  createdAt: string;
}

export function homePathForRole(role: AccountRole): string {
  if (role === 'admin') return '/admin';
  if (role === 'driver') return '/driver';
  return '/dashboard';
}

export function normalizeAccountRole(value: string | null | undefined): AccountRole {
  if (value === 'admin' || value === 'driver' || value === 'passenger') {
    return value;
  }
  return 'passenger';
}
