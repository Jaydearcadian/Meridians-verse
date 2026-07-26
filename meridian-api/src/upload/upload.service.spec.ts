import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import {
  UploadService,
  ALLOWED_MIME_TYPES,
  MAX_FILE_SIZE,
} from './upload.service';
import { StorageProvider } from './storage-provider.interface';

// Valid magic-byte headers for each allowed type
const MAGIC: Record<string, Buffer> = {
  'image/jpeg': Buffer.from([0xff, 0xd8, 0xff, 0x00]),
  'image/png': Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  'image/gif': Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x00]),
  'application/pdf': Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d]),
};

function makeFile(
  overrides: Partial<Express.Multer.File> & { mimetype: string },
): Express.Multer.File {
  const magic = MAGIC[overrides.mimetype] ?? Buffer.alloc(0);
  return {
    originalname: 'test.png',
    size: magic.length,
    buffer: magic,
    ...overrides,
  } as Express.Multer.File;
}

describe('UploadService', () => {
  let service: UploadService;
  let storageProvider: jest.Mocked<StorageProvider>;

  beforeEach(async () => {
    storageProvider = {
      uploadFile: jest.fn().mockResolvedValue('/uploads/test.png'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UploadService,
        { provide: 'STORAGE_PROVIDER', useValue: storageProvider },
      ],
    }).compile();

    service = module.get<UploadService>(UploadService);
  });

  // ── happy path ─────────────────────────────────────────────────────────────

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it.each(ALLOWED_MIME_TYPES)(
    'accepts valid %s files and delegates to the storage provider',
    async (mime) => {
      const file = makeFile({ mimetype: mime, originalname: 'file' });
      storageProvider.uploadFile.mockResolvedValueOnce('/uploads/file');

      const result = await service.uploadFile(file);
      expect(storageProvider.uploadFile).toHaveBeenCalledWith(file);
      expect(result).toEqual({ url: '/uploads/file', originalName: 'file' });
    },
  );

  // ── missing file ────────────────────────────────────────────────────────────

  it('throws BadRequestException when file is undefined', async () => {
    await expect(
      service.uploadFile(undefined as unknown as Express.Multer.File),
    ).rejects.toThrow(BadRequestException);
  });

  // ── MIME-type validation ────────────────────────────────────────────────────

  it('throws BadRequestException for a disallowed MIME type', async () => {
    const file = makeFile({
      mimetype: 'application/javascript',
      buffer: Buffer.from('alert(1)'),
    });

    await expect(service.uploadFile(file)).rejects.toThrow(BadRequestException);
    await expect(service.uploadFile(file)).rejects.toThrow(/not allowed/i);
  });

  it('throws BadRequestException for application/octet-stream', async () => {
    const file = makeFile({
      mimetype: 'application/octet-stream',
      buffer: Buffer.from([0x4d, 0x5a]), // PE header (Windows exe)
    });
    await expect(service.uploadFile(file)).rejects.toThrow(BadRequestException);
  });

  // ── magic-byte validation ───────────────────────────────────────────────────

  it('throws BadRequestException when buffer does not match declared MIME (jpeg spoofed as png)', async () => {
    const file = makeFile({
      mimetype: 'image/png',
      // JPEG magic bytes, not PNG
      buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]),
    });
    await expect(service.uploadFile(file)).rejects.toThrow(BadRequestException);
    await expect(service.uploadFile(file)).rejects.toThrow(/magic byte/i);
  });

  it('throws BadRequestException when an exe is disguised as a PDF', async () => {
    const file = makeFile({
      mimetype: 'application/pdf',
      originalname: 'invoice.pdf',
      // MZ (Windows executable) magic bytes instead of %PDF
      buffer: Buffer.from([0x4d, 0x5a, 0x90, 0x00]),
    });
    await expect(service.uploadFile(file)).rejects.toThrow(BadRequestException);
  });

  it('accepts GIF87a magic bytes for image/gif', async () => {
    const gif87aBuffer = Buffer.from([
      0x47, 0x49, 0x46, 0x38, 0x37, 0x61, 0x01, 0x00,
    ]);
    const file = makeFile({
      mimetype: 'image/gif',
      originalname: 'anim.gif',
      buffer: gif87aBuffer,
    });
    storageProvider.uploadFile.mockResolvedValueOnce('/uploads/anim.gif');
    const result = await service.uploadFile(file);
    expect(result.url).toBe('/uploads/anim.gif');
  });

  // ── size constant ───────────────────────────────────────────────────────────

  it('exports MAX_FILE_SIZE of 5 MB', () => {
    expect(MAX_FILE_SIZE).toBe(5 * 1024 * 1024);
  });

  it('exports the expected ALLOWED_MIME_TYPES', () => {
    expect(ALLOWED_MIME_TYPES).toEqual(
      expect.arrayContaining([
        'image/jpeg',
        'image/png',
        'image/gif',
        'application/pdf',
      ]),
    );
  });
});
