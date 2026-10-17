/** Thin wrapper around the extension's native message catalog. */
export function message(key: string, substitutions?: string | string[]): string {
  if (typeof chrome !== 'undefined' && chrome.i18n?.getMessage) {
    const translated = chrome.i18n.getMessage(key, substitutions);
    if (translated) return translated;
  }
  return key;
}

/** Apply data-i18n attributes after the document is parsed. */
export function localizeDocument(): void {
  if (typeof document === 'undefined') return;
  document.querySelectorAll<HTMLElement>('[data-i18n]').forEach((element) => {
    const key = element.dataset.i18n;
    if (key) element.textContent = message(key);
  });
  document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('[data-i18n-placeholder]').forEach((element) => {
    const key = element.dataset.i18nPlaceholder;
    if (key) element.placeholder = message(key);
  });
  document.querySelectorAll<HTMLElement>('[data-i18n-title]').forEach((element) => {
    const key = element.dataset.i18nTitle;
    if (key) element.title = message(key);
  });
  document.querySelectorAll<HTMLElement>('[data-i18n-aria-label]').forEach((element) => {
    const key = element.dataset.i18nAriaLabel;
    if (key) element.setAttribute('aria-label', message(key));
  });
  if (typeof chrome !== 'undefined' && chrome.i18n?.getUILanguage) {
    document.documentElement.lang = chrome.i18n.getUILanguage().split('-')[0] || 'en';
  }
}
