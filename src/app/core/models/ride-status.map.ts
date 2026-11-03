import { RideStatus } from './care-ride.models';
import { LocalRideStatus } from './local-ride.model';

export function toSqlRideStatus(status: LocalRideStatus): RideStatus {
  const map: Record<LocalRideStatus, RideStatus> = {
    Pending: 'pending',
    Scheduled: 'pending',
    'Driver Assigned': 'assigned',
    'Driver On The Way': 'on_the_way',
    Arrived: 'arrived',
    'Picked Up': 'picked_up',
    'In Progress': 'in_transit',
    Completed: 'completed',
    Cancelled: 'cancelled',
    Rejected: 'rejected',
    Reported: 'reported',
  };
  return map[status];
}

export function toUiRideStatus(
  status: RideStatus | string,
  bookingType?: 'now' | 'schedule' | null,
): LocalRideStatus {
  if (status === 'pending' && bookingType === 'schedule') {
    return 'Scheduled';
  }
  const map: Record<string, LocalRideStatus> = {
    pending: 'Pending',
    assigned: 'Driver Assigned',
    accepted: 'Driver Assigned',
    on_the_way: 'Driver On The Way',
    arrived: 'Arrived',
    picked_up: 'Picked Up',
    in_transit: 'In Progress',
    completed: 'Completed',
    cancelled: 'Cancelled',
    rejected: 'Rejected',
    reported: 'Reported',
  };
  return map[status] ?? 'Pending';
}
