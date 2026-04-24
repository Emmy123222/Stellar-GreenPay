import { useState, useEffect, useCallback } from 'react';

export function useAutocomplete<T>(
  fetcher: (query: string) => Promise<T[]>,
  delay: number = 300
) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<T[]>([]);
  const [loading, setLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  useEffect(() => {
    if (query.length < 2) {
      setResults([]);
      setIsOpen(false);
      return;
    }

    const handler = setTimeout(async () => {
      setLoading(true);
      try {
        const data = await fetcher(query);
        setResults(data);
        setIsOpen(data.length > 0);
      } catch (error) {
        console.error('Autocomplete fetch error:', error);
      } finally {
        setLoading(false);
      }
    }, delay);

    return () => clearTimeout(handler);
  }, [query, fetcher, delay]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex(prev => (prev < results.length - 1 ? prev + 1 : prev));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex(prev => (prev > 0 ? prev - 1 : prev));
    } else if (e.key === 'Enter') {
      if (activeIndex >= 0 && activeIndex < results.length) {
        // This will be handled by the component using this hook
      }
    } else if (e.key === 'Escape') {
      setIsOpen(false);
    }
  };

  return {
    query,
    setQuery,
    results,
    loading,
    isOpen,
    setIsOpen,
    activeIndex,
    setActiveIndex,
    handleKeyDown
  };
}
