/**
 * hooks/useDeepLink.ts
 * Handles greenpay:// deep links and navigates to the correct screen.
 *
 * Supported URLs:
 *   greenpay://project/:id       → /projects/:id
 *   greenpay://donate/:projectId → /donate/:projectId
 *
 * Security: projectId is validated against ^[A-Za-z0-9_-]{1,64}$ to prevent
 * path traversal and injection attacks via malformed deep links.
 */
import { useEffect } from 'react';
import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
import { Alert } from 'react-native';

// projectId must be 1-64 chars of alphanumeric, underscore, or hyphen.
const PROJECT_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Validates a projectId string against the expected format.
 * Returns true if valid, false otherwise.
 */
function isValidProjectId(id: string): boolean {
  return PROJECT_ID_RE.test(id);
}

/**
 * Shows an alert for invalid deep link format.
 */
function showInvalidLinkAlert() {
  Alert.alert('Invalid link format', 'The deep link contains an invalid project ID.');
}

export function useDeepLink() {
  const router = useRouter();

  function handleUrl(url: string | null) {
    if (!url) return;

    const { path } = Linking.parse(url);
    if (!path) return;

    // Parse: "segment/param" → [segment, param]
    const [segment, param] = path.replace(/^\//, '').split('/');
    if (!param) return;

    if (segment === 'project') {
      // Project IDs are numeric or slug-based; validate before navigating
      if (!isValidProjectId(param)) {
        showInvalidLinkAlert();
        return;
      }
      router.push(`/projects/${param}`);
    } else if (segment === 'donate') {
      // Donate links require a valid projectId to prevent injection
      if (!isValidProjectId(param)) {
        showInvalidLinkAlert();
        return;
      }
      router.push(`/donate/${param}`);
    }
    // Unknown segments are silently ignored for security
  }

  useEffect(() => {
    // Handle the link that launched the app (cold start)
    Linking.getInitialURL().then(handleUrl);

    // Handle links received while the app is already open
    const subscription = Linking.addEventListener('url', ({ url }) => handleUrl(url));
    return () => subscription.remove();
  }, []);
}
