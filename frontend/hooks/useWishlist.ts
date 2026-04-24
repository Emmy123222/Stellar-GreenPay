import { useState, useEffect } from 'react';

export function useWishlist() {
  const [wishlist, setWishlist] = useState<string[]>([]);

  useEffect(() => {
    const stored = localStorage.getItem('wishlist');
    if (stored) {
      try {
        setWishlist(JSON.parse(stored));
      } catch (e) {
        console.error('Failed to parse wishlist from localStorage', e);
      }
    }
  }, []);

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
