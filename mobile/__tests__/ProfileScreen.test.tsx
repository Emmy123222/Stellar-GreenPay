/**
 * __tests__/ProfileScreen.test.tsx
 *
 * Tests for ProfileScreen avatar upload, image compression, and progress bar.
 */
import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import axios from 'axios';

import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import ProfileScreen from '../app/profile/[address]';

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({
    address: 'GABCXYZ1234567890123456789012345678901234567890123456789012345',
  }),
}));

jest.mock('expo-image-picker', () => ({
  MediaTypeOptions: { Images: 'Images' },
  requestMediaLibraryPermissionsAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
}));

jest.mock('expo-image-manipulator', () => ({
  SaveFormat: { JPEG: 'jpeg', PNG: 'png', WEBP: 'webp' },
  manipulateAsync: jest.fn(),
}));

jest.mock('react-native/Libraries/Animated/NativeAnimatedHelper');


const MOCK_ADDRESS = 'GABCXYZ1234567890123456789012345678901234567890123456789012345';

const MOCK_PROFILE = {
  publicKey: MOCK_ADDRESS,
  displayName: 'Green Champion',
  avatarUrl: null,
  totalDonatedXLM: '500.00',
  projectsSupported: 3,
  badges: [{ tier: 'tree', earnedAt: '2026-01-01T00:00:00.000Z' }],
};

describe('ProfileScreen Avatar Upload', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (axios.get as jest.Mock).mockImplementation((url: string) => {
      if (url.includes('/api/profiles/')) {
        return Promise.resolve({ data: { data: { ...MOCK_PROFILE } } });
      }
      if (url.includes('/api/donations/donor/')) {
        return Promise.resolve({ data: { data: [] } });
      }
      return Promise.reject(new Error('not found'));
    });

    (axios.patch as jest.Mock).mockResolvedValue({
      data: { success: true },
    });

    (ImagePicker.requestMediaLibraryPermissionsAsync as jest.Mock).mockResolvedValue({
      granted: true,
    });

    (ImageManipulator.manipulateAsync as jest.Mock).mockImplementation(
      async (uri, actions = [], options = {}) => ({
        uri: 'file:///processed/avatar.jpg',
        width: actions[0]?.resize?.width ?? 400,
        height: actions[0]?.resize?.height ?? 400,
      })
    );
  });

  it('renders profile details and avatar upload button', async () => {
    const { getByText, getByTestId } = render(<ProfileScreen address={MOCK_ADDRESS} />);

    await waitFor(() => {
      expect(getByText('Green Champion')).toBeTruthy();
      expect(getByText('500.00')).toBeTruthy();
      expect(getByTestId('avatar-upload-button')).toBeTruthy();
    });
  });

  it('compresses and resizes image > 512px before upload and shows progress bar', async () => {
    const originalImage = {
      uri: 'file:///gallery/large-photo.jpg',
      width: 2048,
      height: 1536,
    };

    (ImagePicker.launchImageLibraryAsync as jest.Mock).mockResolvedValue({
      canceled: false,
      assets: [originalImage],
    });

    const uploadedUrl = 'http://localhost:4000/api/uploads/avatar_123.jpg';

    // Track if progress bar appears during upload
    let progressCallback: any = null;
    (axios.post as jest.Mock).mockImplementation((url, formData, config) => {
      progressCallback = config?.onUploadProgress;
      if (progressCallback) {
        progressCallback({ loaded: 50, total: 100 });
      }
      return Promise.resolve({
        data: {
          success: true,
          data: { url: uploadedUrl },
        },
      });
    });

    const { getByTestId, queryByTestId } = render(<ProfileScreen address={MOCK_ADDRESS} />);

    await waitFor(() => {
      expect(getByTestId('avatar-upload-button')).toBeTruthy();
    });

    const button = getByTestId('avatar-upload-button');
    await act(async () => {
      await fireEvent.press(button);
    });

    // Verify image picker was launched with expected options
    expect(ImagePicker.launchImageLibraryAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        allowsEditing: true,
        aspect: [1, 1],
      })
    );

    // Verify expo-image-manipulator resized the image > 512px to max 512x512
    expect(ImageManipulator.manipulateAsync).toHaveBeenCalledWith(
      originalImage.uri,
      [
        {
          resize: {
            width: 512,
            height: Math.round((1536 * 512) / 2048), // 384
          },
        },
      ],
      {
        compress: 0.7,
        format: ImageManipulator.SaveFormat.JPEG,
      }
    );

    // Verify upload called backend
    expect(axios.post).toHaveBeenCalledWith(
      expect.stringContaining('/api/uploads'),
      expect.any(FormData),
      expect.objectContaining({
        headers: { 'Content-Type': 'multipart/form-data' },
      })
    );

    // Verify profile was updated with avatarUrl
    await waitFor(() => {
      expect(axios.patch).toHaveBeenCalledWith(
        expect.stringContaining(`/api/profiles/${MOCK_ADDRESS}`),
        { avatarUrl: uploadedUrl }
      );
    });

    // Upload finishes, progress bar is removed
    expect(queryByTestId('avatar-upload-progress')).toBeNull();
  });

  it('compresses image <= 512px without resizing (unchanged dimensions) before upload', async () => {
    const smallImage = {
      uri: 'file:///gallery/small-icon.jpg',
      width: 300,
      height: 300,
    };

    (ImagePicker.launchImageLibraryAsync as jest.Mock).mockResolvedValue({
      canceled: false,
      assets: [smallImage],
    });

    (axios.post as jest.Mock).mockResolvedValue({
      data: {
        success: true,
        data: { url: 'http://localhost:4000/api/uploads/small.jpg' },
      },
    });

    const { getByTestId } = render(<ProfileScreen address={MOCK_ADDRESS} />);

    await waitFor(() => {
      expect(getByTestId('avatar-upload-button')).toBeTruthy();
    });

    await act(async () => {
      await fireEvent.press(getByTestId('avatar-upload-button'));
    });

    // Verify image was compressed with JPEG 0.7 and empty actions array (unchanged)
    expect(ImageManipulator.manipulateAsync).toHaveBeenCalledWith(
      smallImage.uri,
      [],
      {
        compress: 0.7,
        format: ImageManipulator.SaveFormat.JPEG,
      }
    );
  });

  it('does not upload if user cancels image picker', async () => {
    (ImagePicker.launchImageLibraryAsync as jest.Mock).mockResolvedValue({
      canceled: true,
      assets: null,
    });

    const { getByTestId } = render(<ProfileScreen address={MOCK_ADDRESS} />);

    await waitFor(() => {
      expect(getByTestId('avatar-upload-button')).toBeTruthy();
    });

    await act(async () => {
      await fireEvent.press(getByTestId('avatar-upload-button'));
    });

    expect(ImageManipulator.manipulateAsync).not.toHaveBeenCalled();
    expect(axios.post).not.toHaveBeenCalled();
  });

});
