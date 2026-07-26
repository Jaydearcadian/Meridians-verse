import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { StorageProvider } from './storage-provider.interface';

/**
 * Magic-byte signatures for allowed file types.
 *
 * Each entry maps a MIME type to one or more byte sequences that should appear
 * at the start of a valid file of that type.  Checking magic bytes prevents
 * attackers from bypassing the MIME-type filter by renaming a file.
 */
const MAGIC_BYTES: Record<string, Buffer[]> = {
  'image/jpeg': [Buffer.from([0xff, 0xd8, 0xff])],
  'image/png': [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
  'image/gif': [
    Buffer.from([0x47, 0x49, 0x46, 0x38, 0x37, 0x61]), // GIF87a
    Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]), // GIF89a
  ],
  'application/pdf': [Buffer.from([0x25, 0x50, 0x44, 0x46])], // %PDF
};

/** MIME types accepted by this service (mirrors the controller's FileTypeValidator). */
export const ALLOWED_MIME_TYPES = Object.keys(MAGIC_BYTES);

/** Maximum file size in bytes (5 MB). Also enforced at the controller layer. */
export const MAX_FILE_SIZE = 5 * 1024 * 1024;

@Injectable()
export class UploadService {
  constructor(
    @Inject('STORAGE_PROVIDER')
    private readonly storageProvider: StorageProvider,
  ) {}

  async uploadFile(
    file: Express.Multer.File,
  ): Promise<{ url: string; originalName: string }> {
    if (!file) {
      throw new BadRequestException('No file uploaded or file is invalid');
    }

    this.validateMimeType(file);
    this.validateMagicBytes(file);

    const url = await this.storageProvider.uploadFile(file);
    return { url, originalName: file.originalname };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private validateMimeType(file: Express.Multer.File): void {
    if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      throw new BadRequestException(
        `File type "${file.mimetype}" is not allowed. ` +
          `Accepted types: ${ALLOWED_MIME_TYPES.join(', ')}`,
      );
    }
  }

  /**
   * Validates the file buffer against known magic bytes for its declared MIME
   * type.  This prevents simple MIME-spoofing attacks (e.g. an .exe renamed
   * to .png with a faked Content-Type header).
   */
  private validateMagicBytes(file: Express.Multer.File): void {
    const signatures = MAGIC_BYTES[file.mimetype];
    if (!signatures) return; // guarded already by validateMimeType

    const isValid = signatures.some((sig) =>
      file.buffer.slice(0, sig.length).equals(sig),
    );

    if (!isValid) {
      throw new BadRequestException(
        'File content does not match its declared type (magic byte mismatch)',
      );
    }
  }
}
