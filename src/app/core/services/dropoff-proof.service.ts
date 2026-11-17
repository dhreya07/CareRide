import { Injectable } from '@angular/core';
import { environment } from '../../../environments/environment';
import { isProfileUuid } from '../models/profile-id';
import { distanceMeters } from './healthcare-facilities';
import { MapsService, isUsableCoordinate } from './maps.service';
import { getSharedSupabaseClient } from './supabase-client';

const PROOF_BUCKET = 'careride-dropoff-proofs';
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_EDGE_PX = 1600;
const SIGNED_URL_SECONDS = 300;
const GPS_MAX_ACCURACY_METERS = 100;
const GPS_MAX_AGE_MS = 30_000;
const DROPOFF_RADIUS_METERS = 250;

export interface DropoffProof {
  bookingId: string;
  storagePath: string;
  uploadedAt: string;
}

export interface DropoffProofContext {
  destinationLabel: string;
  destinationLatitude: number | null | undefined;
  destinationLongitude: number | null | undefined;
}

interface VerifiedDropoffFix {
  latitude: number;
  longitude: number;
  accuracyMeters: number;
  capturedAt: string;
}

/**
 * Handles the optional safe-arrival photo for a completed cloud booking.
 * Files are kept in a private bucket; callers receive short-lived signed URLs only.
 */
@Injectable({ providedIn: 'root' })
export class DropoffProofService {
  constructor(private maps: MapsService) {}

  async upload(bookingId: string, source: File, context: DropoffProofContext): Promise<DropoffProof> {
    this.requireCloudBooking(bookingId);
    if (!source || source.size <= 0 || source.size > MAX_FILE_BYTES) {
      throw new Error('Choose an image smaller than 5 MB.');
    }
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(source.type)) {
      throw new Error('Choose a JPG, PNG, or WebP image.');
    }

    const client = getSharedSupabaseClient();
    await this.requireSession();
    const fix = await this.requireDestinationFix(context);
    const image = await this.prepareProofImage(source, context.destinationLabel, fix.capturedAt);
    const objectId = this.newId();
    const storagePath = `bookings/${bookingId}/${objectId}.jpg`;

    const { error: uploadError } = await client.storage
      .from(PROOF_BUCKET)
      .upload(storagePath, image, { contentType: 'image/jpeg', upsert: false });
    if (uploadError) {
      throw new Error('The photo could not be uploaded. Check your connection, then try again.');
    }

    try {
      const { data, error } = await client.rpc('submit_booking_dropoff_proof_attested', {
        p_booking_id: bookingId,
        p_storage_path: storagePath,
        p_captured_at: fix.capturedAt,
        p_latitude: fix.latitude,
        p_longitude: fix.longitude,
        p_accuracy_m: fix.accuracyMeters,
      });
      if (error) {
        throw new Error('The photo was captured but could not be verified for this completed trip. Please try again at the destination.');
      }
      return this.toProof(data, bookingId, storagePath);
    } catch (error) {
      // The caller owns an unfinalized object only. Cleanup cannot overwrite an existing proof.
      await client.storage.from(PROOF_BUCKET).remove([storagePath]).catch(() => undefined);
      throw error;
    }
  }

  async listForCurrentPassenger(): Promise<DropoffProof[]> {
    this.requireCloudEnabled();
    const client = getSharedSupabaseClient();
    await this.requireSession();
    const { data, error } = await client.rpc('list_my_dropoff_proofs');
    if (error) {
      throw new Error('Arrival photos could not be loaded.');
    }
    return (Array.isArray(data) ? data : [])
      .map((row) => this.toProof(row, '', ''))
      .filter((proof) => isProfileUuid(proof.bookingId) && this.validStoragePath(proof.storagePath));
  }

  async createViewUrl(proof: DropoffProof): Promise<string | null> {
    this.requireCloudBooking(proof.bookingId);
    if (!this.validStoragePath(proof.storagePath)) {
      return null;
    }
    const client = getSharedSupabaseClient();
    await this.requireSession();
    const { data, error } = await client.storage
      .from(PROOF_BUCKET)
      .createSignedUrl(proof.storagePath, SIGNED_URL_SECONDS);
    return error || !data?.signedUrl ? null : data.signedUrl;
  }

  private requireCloudBooking(bookingId: string): void {
    this.requireCloudEnabled();
    if (!isProfileUuid(bookingId)) {
      throw new Error('This arrival photo can only be attached to a secure cloud booking.');
    }
  }

  private requireCloudEnabled(): void {
    if (environment.supabase.cloudMigration !== true) {
      throw new Error('Secure cloud bookings are not enabled yet.');
    }
  }

  private async requireSession(): Promise<string> {
    const { data, error } = await getSharedSupabaseClient().auth.getUser();
    if (error || !data.user || !isProfileUuid(data.user.id)) {
      throw new Error('Sign in before continuing.');
    }
    return data.user.id;
  }

  private async requireDestinationFix(context: DropoffProofContext): Promise<VerifiedDropoffFix> {
    const fix = await this.maps.currentPosition().catch(() => {
      throw new Error('Location is required to verify safe arrival. Allow GPS and try again at the destination.');
    });
    const capturedAt = fix.capturedAt;
    const captured = capturedAt ? Date.parse(capturedAt) : NaN;
    const accuracy = fix.accuracyMeters;
    const destinationLatitude = context.destinationLatitude;
    const destinationLongitude = context.destinationLongitude;
    if (
      !isUsableCoordinate(fix.latitude, fix.longitude) ||
      typeof accuracy !== 'number' || !Number.isFinite(accuracy) || accuracy < 0 || accuracy > GPS_MAX_ACCURACY_METERS ||
      !Number.isFinite(captured) || captured > Date.now() || Date.now() - captured > GPS_MAX_AGE_MS
    ) {
      throw new Error('A fresh GPS fix within 100 metres is required to verify safe arrival.');
    }
    if (
      typeof destinationLatitude !== 'number' || typeof destinationLongitude !== 'number' ||
      !isUsableCoordinate(destinationLatitude, destinationLongitude)
    ) {
      throw new Error('This booking has no confirmed destination pin, so arrival cannot be verified.');
    }
    if (distanceMeters(fix, { latitude: destinationLatitude, longitude: destinationLongitude }) > DROPOFF_RADIUS_METERS) {
      throw new Error('Move closer to the confirmed destination before sending the safe-arrival photo.');
    }
    return { latitude: fix.latitude, longitude: fix.longitude, accuracyMeters: accuracy, capturedAt: capturedAt! };
  }

  private async prepareProofImage(source: File, destinationLabel: string, capturedAt: string): Promise<File> {
    if (typeof document === 'undefined' || typeof URL === 'undefined') {
      throw new Error('This device cannot prepare the arrival photo.');
    }
    const objectUrl = URL.createObjectURL(source);
    try {
      const image = await new Promise<HTMLImageElement>((resolve, reject) => {
        const element = new Image();
        element.onload = () => resolve(element);
        element.onerror = () => reject(new Error('The selected image could not be read.'));
        element.src = objectUrl;
      });
      const scale = Math.min(1, MAX_EDGE_PX / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext('2d');
      if (!context) {
        throw new Error('This device cannot prepare the arrival photo.');
      }
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      this.drawProofStamp(context, canvas.width, canvas.height, destinationLabel, capturedAt);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.88));
      if (!blob) {
        throw new Error('This device cannot prepare the arrival photo.');
      }
      return new File([blob], 'safe-arrival.jpg', { type: 'image/jpeg' });
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }

  private drawProofStamp(
    context: CanvasRenderingContext2D,
    width: number,
    height: number,
    destinationLabel: string,
    capturedAt: string,
  ): void {
    const label = this.shortLabel(destinationLabel || 'Confirmed destination');
    const time = new Date(capturedAt);
    const readableTime = Number.isNaN(time.getTime())
      ? 'Capture time unavailable'
      : time.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
    const padding = Math.max(18, Math.round(width * 0.025));
    const lineHeight = Math.max(18, Math.round(width * 0.028));
    const stampHeight = padding * 2 + lineHeight * 3;
    context.fillStyle = 'rgba(3, 31, 37, 0.82)';
    context.fillRect(0, height - stampHeight, width, stampHeight);
    context.fillStyle = '#ffffff';
    context.font = `700 ${Math.max(16, Math.round(width * 0.027))}px system-ui, sans-serif`;
    context.fillText('CareRide safe-arrival proof', padding, height - stampHeight + padding + lineHeight);
    context.font = `500 ${Math.max(14, Math.round(width * 0.022))}px system-ui, sans-serif`;
    context.fillText(`Destination: ${label}`, padding, height - stampHeight + padding + lineHeight * 2);
    context.fillText(`Captured: ${readableTime}`, padding, height - stampHeight + padding + lineHeight * 3);
  }

  private shortLabel(value: string): string {
    const text = value.trim().replace(/\s+/g, ' ');
    return text.length > 72 ? `${text.slice(0, 69)}…` : text;
  }

  private toProof(value: unknown, fallbackBookingId: string, fallbackPath: string): DropoffProof {
    const row = value && typeof value === 'object' ? value as Record<string, unknown> : {};
    return {
      bookingId: typeof row['booking_id'] === 'string' ? row['booking_id'] : fallbackBookingId,
      storagePath: typeof row['storage_path'] === 'string' ? row['storage_path'] : fallbackPath,
      uploadedAt: typeof row['created_at'] === 'string' ? row['created_at'] : new Date().toISOString(),
    };
  }

  private validStoragePath(path: string): boolean {
    return /^bookings\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/[0-9a-f-]{36}\.jpg$/i.test(path);
  }

  private newId(): string {
    const id = globalThis.crypto?.randomUUID?.();
    if (!id) {
      throw new Error('This device cannot securely prepare the arrival photo.');
    }
    return id;
  }
}
