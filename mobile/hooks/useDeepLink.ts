/**
 * hooks/useDeepLink.ts
 * Handles greenpay:// deep links and navigates to the correct screen.
 *
 * Supported URLs:
 *   greenpay://project/123       → /projects/123
 *   greenpay://donate/G...ABC    → /donate/G...ABC  (address pre-selects via id param)
 */
import { useEffect } from 'react';
import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';

export function useDeepLink() {
  const router = useRouter();

  function handleUrl(url: string | null) {
    if (!url) return;
    const { path } = Linking.parse(url);
    if (!path) return;

    const [segment, param] = path.replace(/^\//, '').split('/');
    if (!param) return;

    if (segment === 'project') {
      router.push(`/projects/${param}`);
    } else if (segment === 'donate') {
      router.push(`/donate/${param}`);
    }
  }

  useEffect(() => {
    // Handle the link that launched the app (cold start)
    Linking.getInitialURL().then(handleUrl);

    // Handle links received while the app is already open
    const subscription = Linking.addEventListener('url', ({ url }) => handleUrl(url));
    return () => subscription.remove();
  }, []);
}
