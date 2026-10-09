let formattingLocale = "en-US";

export function setFormattingLocale(locale: string): void {
  formattingLocale = locale;
}

export function getFormattingLocale(): string {
  return formattingLocale;
}
