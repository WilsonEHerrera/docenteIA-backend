const MIN_QUOTE_LENGTH = 3;

const normalize = (text: string): string =>
  text.normalize('NFC').replace(/\s+/g, ' ').trim();

/**
 * A cited excerpt only counts as evidence when it appears literally in the
 * student's text (whitespace-insensitive). Guards against invented quotes.
 */
export function quoteExistsInText(quote: string, text: string): boolean {
  const normalizedQuote = normalize(quote);
  if (normalizedQuote.length < MIN_QUOTE_LENGTH) return false;
  return normalize(text).includes(normalizedQuote);
}
