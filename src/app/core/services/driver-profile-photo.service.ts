
import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';

export type DriverAvatarColor =
  | 'teal'
  | 'blue'
  | 'purple'
  | 'peach';

/**
 * Local-only driver profile photo and avatar preferences.
 *
 * - No Supabase Storage or cloud configuration changes.
 * - Photos and avatar colors are stored per driver ID.
 * - Photos are compressed before saving.
 * - Profile and Dashboard can observe changes.
 */
@Injectable({
  providedIn: 'root',
})
export class DriverProfilePhotoService {
  private readonly storagePrefix =
    'careride_driver_photo_v1_';

  private readonly avatarColorPrefix =
    'careride_driver_avatar_color_v1_';

  readonly avatarColors: readonly DriverAvatarColor[] = [
    'teal',
    'blue',
    'purple',
    'peach',
  ];

  private readonly photoChangedSubject =
    new BehaviorSubject<string | null>(null);

  readonly photoChanged$: Observable<string | null> =
    this.photoChangedSubject.asObservable();

  /**
   * Read the locally saved photo for a driver.
   */
  getPhoto(driverId: string, scope: 'driver' | 'passenger' = 'driver'): string | null {
    const key = this.getStorageKey(driverId, scope);

    if (!key) {
      return null;
    }

    try {
      const photo = localStorage.getItem(key);

      return photo?.startsWith('data:image/jpeg;base64,')
        ? photo
        : null;
    } catch {
      return null;
    }
  }

  /**
   * Compress and save the selected photo locally.
   */
  async savePhoto(
    driverId: string,
    file: File,
    scope: 'driver' | 'passenger' = 'driver',
  ): Promise<string> {
    const key = this.getStorageKey(driverId, scope);

    if (!key) {
      throw new Error(
        'Account is unavailable. Please sign in again.',
      );
    }

    if (!file.type.startsWith('image/')) {
      throw new Error(
        'Please select a valid image file.',
      );
    }

    const maximumFileSize = 10 * 1024 * 1024;

    if (file.size > maximumFileSize) {
      throw new Error(
        'The selected image is too large. Maximum size is 10 MB.',
      );
    }

    if (file.size === 0) {
      throw new Error(
        'The selected image is empty.',
      );
    }

    const compressedPhoto = await this.compressImage(file);

    try {
      localStorage.setItem(key, compressedPhoto);
    } catch {
      throw new Error(
        'Unable to save the picture on this device. Please free up browser storage and try again.',
      );
    }

    if (scope === 'driver') this.photoChangedSubject.next(driverId);

    return compressedPhoto;
  }

  /**
   * Remove the locally saved photo.
   */
  removePhoto(driverId: string, scope: 'driver' | 'passenger' = 'driver'): void {
    const key = this.getStorageKey(driverId, scope);

    if (!key) {
      return;
    }

    try {
      localStorage.removeItem(key);
    } catch {
      throw new Error(
        'Unable to remove the picture from this device.',
      );
    }

    if (scope === 'driver') this.photoChangedSubject.next(driverId);
  }

  /**
   * Read the driver's saved avatar color.
   */
  getAvatarColor(driverId: string): DriverAvatarColor {
    const key = this.getAvatarColorKey(driverId);

    if (!key) {
      return 'teal';
    }

    try {
      const saved = localStorage.getItem(key);

      if (this.isAvatarColor(saved)) {
        return saved;
      }
    } catch {
      // Fall back to the default color.
    }

    return 'teal';
  }

  /**
   * Save the driver's avatar color locally.
   */
  setAvatarColor(
    driverId: string,
    color: DriverAvatarColor,
  ): void {
    const key = this.getAvatarColorKey(driverId);

    if (!key) {
      throw new Error(
        'Account is unavailable. Please sign in again.',
      );
    }

    if (!this.isAvatarColor(color)) {
      throw new Error('Invalid avatar color.');
    }

    try {
      localStorage.setItem(key, color);
    } catch {
      throw new Error(
        'Unable to save avatar color on this device.',
      );
    }

    this.photoChangedSubject.next(driverId);
  }

  /**
   * Notify subscribers to reload a driver's
   * saved photo and avatar color.
   *
   * The emitted value is the driver ID,
   * not the image URL.
   */
  refreshPhoto(driverId: string): void {
    if (!this.getStorageKey(driverId)) {
      return;
    }

    this.photoChangedSubject.next(driverId);
  }

  /**
   * Validate an avatar color.
   */
  private isAvatarColor(
    value: string | null,
  ): value is DriverAvatarColor {
    return (
      value === 'teal' ||
      value === 'blue' ||
      value === 'purple' ||
      value === 'peach'
    );
  }

  /**
   * Generate a driver-specific photo storage key.
   */
  private getStorageKey(driverId: string, scope: 'driver' | 'passenger' = 'driver'): string | null {
    const normalizedId = driverId.trim();

    if (!normalizedId) {
      return null;
    }

    return (
      (scope === 'driver' ? this.storagePrefix : 'careride_passenger_photo_v1_') +
      encodeURIComponent(normalizedId)
    );
  }

  /**
   * Generate a driver-specific avatar color key.
   */
  private getAvatarColorKey(
    driverId: string,
  ): string | null {
    const normalizedId = driverId.trim();

    if (!normalizedId) {
      return null;
    }

    return (
      this.avatarColorPrefix +
      encodeURIComponent(normalizedId)
    );
  }

  /**
   * Resize and compress an image to JPEG.
   * Maximum dimension: 400px.
   * JPEG quality: 75%.
   */
  private compressImage(file: File): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();

      reader.onerror = () => {
        reject(
          new Error('Unable to read the selected picture.'),
        );
      };

      reader.onload = () => {
        const source = reader.result;

        if (typeof source !== 'string') {
          reject(
            new Error('Unable to process the selected picture.'),
          );
          return;
        }

        const image = new Image();

        image.onerror = () => {
          reject(
            new Error(
              'This image format could not be opened.',
            ),
          );
        };

        image.onload = () => {
          try {
            const maximumDimension = 400;

            const originalWidth = image.naturalWidth;
            const originalHeight = image.naturalHeight;

            if (!originalWidth || !originalHeight) {
              throw new Error('Invalid image dimensions.');
            }

            const scale = Math.min(
              1,
              maximumDimension /
                Math.max(originalWidth, originalHeight),
            );

            const width = Math.max(
              1,
              Math.round(originalWidth * scale),
            );

            const height = Math.max(
              1,
              Math.round(originalHeight * scale),
            );

            const canvas =
              document.createElement('canvas');

            canvas.width = width;
            canvas.height = height;

            const context = canvas.getContext('2d');

            if (!context) {
              throw new Error(
                'Image processing is unavailable on this device.',
              );
            }

            // White background for transparent images.
            context.fillStyle = '#ffffff';
            context.fillRect(
              0,
              0,
              width,
              height,
            );

            context.drawImage(
              image,
              0,
              0,
              width,
              height,
            );

            const result = canvas.toDataURL(
              'image/jpeg',
              0.75,
            );

            if (
              !result.startsWith(
                'data:image/jpeg;base64,',
              )
            ) {
              throw new Error(
                'Unable to compress the selected picture.',
              );
            }

            resolve(result);
          } catch (error) {
            reject(
              error instanceof Error
                ? error
                : new Error(
                    'Unable to process the picture.',
                  ),
            );
          }
        };

        image.src = source;
      };

      reader.readAsDataURL(file);
    });
  }
}
