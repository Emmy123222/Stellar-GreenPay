import { useState } from 'react';

export function useWishlist() {
  const [wishlist, setWishlist] = useState<string[]>(() => {
    if (typeof window === "undefined") return [];
    const stored = window.localStorage.getItem('wishlist');
    if (stored) {
      try {
        return JSON.parse(stored);
      } catch (e) {
        console.error('Failed to parse wishlist from localStorage', e);
        return [];
      }
    }
    return [];
  });

  const toggleWishlist = (projectId: string) => {
    setWishlist(prev => {
      const updated = prev.includes(projectId)
        ? prev.filter(id => id !== projectId)
        : [...prev, projectId];
      
      localStorage.setItem('wishlist', JSON.stringify(updated));
      return updated;
    });
  };

  return { wishlist, toggleWishlist, isInWishlist: (id: string) => wishlist.includes(id) };
}
