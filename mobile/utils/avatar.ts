/**
 * utils/avatar.ts
 * Avatar image manipulation and upload helpers.
 * Resizes avatar images to max 512x512 and compresses to JPEG quality 0.7 before upload.
 */
import * as ImageManipulator from 'expo-image-manipulator';
import axios from 'axios';

export const MAX_AVATAR_DIMENSION = 512;
export const AVATAR_JPEG_QUALITY = 0.7;

export interface ImageDimensions {
  width?: number;
  height?: number;
}

/**
 * Resizes an image if either dimension exceeds MAX_AVATAR_DIMENSION (512px)
 * and compresses to JPEG with quality 0.7.
 * If both dimensions are <= 512px, dimensions remain unchanged.
 */
export async function processAvatarImage(
  uri: string,
  dimensions?: ImageDimensions
): Promise<ImageManipulator.ImageResult> {
  const actions: ImageManipulator.Action[] = [];
  const width = dimensions?.width;
  const height = dimensions?.height;

  if (typeof width === 'number' && typeof height === 'number') {
    if (width > MAX_AVATAR_DIMENSION || height > MAX_AVATAR_DIMENSION) {
      if (width >= height) {
        actions.push({
          resize: {
            width: MAX_AVATAR_DIMENSION,
            height: Math.round((height * MAX_AVATAR_DIMENSION) / width),
          },
        });
      } else {
        actions.push({
          resize: {
            width: Math.round((width * MAX_AVATAR_DIMENSION) / height),
            height: MAX_AVATAR_DIMENSION,
          },
        });
      }
    }
  } else if (typeof width === 'number' && width > MAX_AVATAR_DIMENSION) {
    actions.push({ resize: { width: MAX_AVATAR_DIMENSION } });
  } else if (typeof height === 'number' && height > MAX_AVATAR_DIMENSION) {
    actions.push({ resize: { height: MAX_AVATAR_DIMENSION } });
  }

  return await ImageManipulator.manipulateAsync(
    uri,
    actions,
    {
      compress: AVATAR_JPEG_QUALITY,
      format: ImageManipulator.SaveFormat.JPEG,
    }
  );
}

/**
 * Uploads a processed avatar image file to backend `/api/uploads`
 * with upload progress reporting.
 */
export async function uploadAvatar(
  imageUri: string,
  onProgress?: (progress: number) => void,
  apiUrl: string = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:4000'
): Promise<string> {
  const formData = new FormData();
  const filename = imageUri.split('/').pop() || 'avatar.jpg';

  formData.append('file', {
    uri: imageUri,
    name: filename,
    type: 'image/jpeg',
  } as any);

  const response = await axios.post(`${apiUrl}/api/uploads`, formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
    onUploadProgress: (progressEvent) => {
      if (progressEvent.total && onProgress) {
        const percentCompleted = Math.min(1, Math.max(0, progressEvent.loaded / progressEvent.total));
        onProgress(percentCompleted);
      }
    },
  });

  const avatarUrl = response.data?.data?.url;
  if (!avatarUrl) {
    throw new Error('Upload succeeded but no avatar URL was returned');
  }

  return avatarUrl;
}
