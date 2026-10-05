/**
 * __tests__/avatar.test.ts
 *
 * Unit tests for avatar image manipulation and upload utilities.
 * Acceptance criteria:
 *  - Use expo-image-manipulator to resize the image to max 512x512 and compress to JPEG quality 0.7 before upload
 *  - Unit test: image > 512px -> resized; image <= 512px -> unchanged
 */
import * as ImageManipulator from 'expo-image-manipulator';
import axios from 'axios';
import {
  processAvatarImage,
  uploadAvatar,
  MAX_AVATAR_DIMENSION,
  AVATAR_JPEG_QUALITY,
} from '../utils/avatar';

jest.mock('expo-image-manipulator', () => ({
  SaveFormat: {
    JPEG: 'jpeg',
    PNG: 'png',
    WEBP: 'webp',
  },
  manipulateAsync: jest.fn(),
}));

describe('processAvatarImage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (ImageManipulator.manipulateAsync as jest.Mock).mockImplementation(
      async (uri, actions = [], options = {}) => ({
        uri: 'file:///processed/avatar.jpg',
        width: actions[0]?.resize?.width ?? 300,
        height: actions[0]?.resize?.height ?? 300,
      })
    );
  });

  it('resizes landscape image when width > 512px', async () => {
    const originalUri = 'file:///original/large-landscape.jpg';
    const dimensions = { width: 1024, height: 768 };

    await processAvatarImage(originalUri, dimensions);

    expect(ImageManipulator.manipulateAsync).toHaveBeenCalledTimes(1);
    expect(ImageManipulator.manipulateAsync).toHaveBeenCalledWith(
      originalUri,
      [
        {
          resize: {
            width: 512,
            height: Math.round((768 * 512) / 1024), // 384
          },
        },
      ],
      {
        compress: AVATAR_JPEG_QUALITY,
        format: ImageManipulator.SaveFormat.JPEG,
      }
    );
  });

  it('resizes portrait image when height > 512px', async () => {
    const originalUri = 'file:///original/large-portrait.jpg';
    const dimensions = { width: 600, height: 1200 };

    await processAvatarImage(originalUri, dimensions);

    expect(ImageManipulator.manipulateAsync).toHaveBeenCalledTimes(1);
    expect(ImageManipulator.manipulateAsync).toHaveBeenCalledWith(
      originalUri,
      [
        {
          resize: {
            width: Math.round((600 * 512) / 1200), // 256
            height: 512,
          },
        },
      ],
      {
        compress: 0.7,
        format: ImageManipulator.SaveFormat.JPEG,
      }
    );
  });

  it('resizes square image when dimension > 512px', async () => {
    const originalUri = 'file:///original/large-square.jpg';
    const dimensions = { width: 2048, height: 2048 };

    await processAvatarImage(originalUri, dimensions);

    expect(ImageManipulator.manipulateAsync).toHaveBeenCalledTimes(1);
    expect(ImageManipulator.manipulateAsync).toHaveBeenCalledWith(
      originalUri,
      [
        {
          resize: {
            width: 512,
            height: 512,
          },
        },
      ],
      {
        compress: 0.7,
        format: ImageManipulator.SaveFormat.JPEG,
      }
    );
  });

  it('does not resize image when dimensions are smaller than 512px (image < 512px -> unchanged)', async () => {
    const originalUri = 'file:///original/small.jpg';
    const dimensions = { width: 400, height: 300 };

    await processAvatarImage(originalUri, dimensions);

    expect(ImageManipulator.manipulateAsync).toHaveBeenCalledTimes(1);
    expect(ImageManipulator.manipulateAsync).toHaveBeenCalledWith(
      originalUri,
      [], // No resize actions
      {
        compress: 0.7,
        format: ImageManipulator.SaveFormat.JPEG,
      }
    );
  });

  it('does not resize image when dimensions are exactly 512px (image == 512px -> unchanged)', async () => {
    const originalUri = 'file:///original/exact.jpg';
    const dimensions = { width: 512, height: 512 };

    await processAvatarImage(originalUri, dimensions);

    expect(ImageManipulator.manipulateAsync).toHaveBeenCalledTimes(1);
    expect(ImageManipulator.manipulateAsync).toHaveBeenCalledWith(
      originalUri,
      [], // No resize actions
      {
        compress: 0.7,
        format: ImageManipulator.SaveFormat.JPEG,
      }
    );
  });

  it('applies max 512 width resize if only width > 512 is provided', async () => {
    const originalUri = 'file:///original/width-only.jpg';
    const dimensions = { width: 800 };

    await processAvatarImage(originalUri, dimensions);

    expect(ImageManipulator.manipulateAsync).toHaveBeenCalledWith(
      originalUri,
      [{ resize: { width: 512 } }],
      {
        compress: 0.7,
        format: ImageManipulator.SaveFormat.JPEG,
      }
    );
  });

  it('applies max 512 height resize if only height > 512 is provided', async () => {
    const originalUri = 'file:///original/height-only.jpg';
    const dimensions = { height: 900 };

    await processAvatarImage(originalUri, dimensions);

    expect(ImageManipulator.manipulateAsync).toHaveBeenCalledWith(
      originalUri,
      [{ resize: { height: 512 } }],
      {
        compress: 0.7,
        format: ImageManipulator.SaveFormat.JPEG,
      }
    );
  });
});

describe('uploadAvatar', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('uploads compressed image and tracks progress', async () => {
    const mockAvatarUrl = 'http://localhost:4000/api/uploads/avatar-key.jpg';
    let progressCallback: any = null;

    (axios.post as jest.Mock).mockImplementation((url, formData, config) => {
      progressCallback = config.onUploadProgress;
      if (progressCallback) {
        progressCallback({ loaded: 50, total: 100 });
        progressCallback({ loaded: 100, total: 100 });
      }
      return Promise.resolve({
        data: {
          success: true,
          data: { url: mockAvatarUrl },
        },
      });
    });

    const progressReports: number[] = [];
    const onProgress = (p: number) => progressReports.push(p);

    const result = await uploadAvatar('file:///tmp/avatar.jpg', onProgress);

    expect(result).toBe(mockAvatarUrl);
    expect(progressReports).toEqual([0.5, 1]);
    expect(axios.post).toHaveBeenCalledWith(
      'http://localhost:4000/api/uploads',
      expect.any(FormData),
      expect.objectContaining({
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: expect.any(Function),
      })
    );
  });

  it('throws an error if upload endpoint returns no url', async () => {
    (axios.post as jest.Mock).mockResolvedValue({
      data: { success: true, data: {} },
    });

    await expect(uploadAvatar('file:///tmp/avatar.jpg')).rejects.toThrow(
      'Upload succeeded but no avatar URL was returned'
    );
  });
});
