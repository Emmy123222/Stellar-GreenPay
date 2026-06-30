/**
 * __tests__/stellarValidation.test.ts
 * Unit tests for the Stellar address validation utility.
 *
 * Covers: valid G-address, wrong prefix, wrong length, bad characters,
 * null/undefined/number inputs.
 */
import { isValidStellarAddress } from '../utils/stellarValidation';

const VALID_ADDRESS = 'GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGLEWZE5BGYTG2XTGQBC3VP';

describe('isValidStellarAddress', () => {
  it('accepts a well-formed 56-character G-address', () => {
    expect(isValidStellarAddress(VALID_ADDRESS)).toBe(true);
  });

  it('accepts an address composed entirely of uppercase letters after G', () => {
    const allLetters = `G${'A'.repeat(55)}`;
    expect(isValidStellarAddress(allLetters)).toBe(true);
  });

  it('accepts an address containing uppercase letters and digits', () => {
    const mixed = `G${'A'.repeat(50)}12345`;
    expect(isValidStellarAddress(mixed)).toBe(true);
  });

  it('rejects an address starting with a lowercase g', () => {
    const lower = VALID_ADDRESS.toLowerCase();
    expect(isValidStellarAddress(lower)).toBe(false);
  });

  it('rejects an address that starts with a character other than G', () => {
    expect(isValidStellarAddress(`S${'A'.repeat(55)}`)).toBe(false);
    expect(isValidStellarAddress(`X${'A'.repeat(55)}`)).toBe(false);
  });

  it('rejects an address that is too short', () => {
    expect(isValidStellarAddress(`G${'A'.repeat(54)}`)).toBe(false);
  });

  it('rejects an address that is too long', () => {
    expect(isValidStellarAddress(`G${'A'.repeat(56)}`)).toBe(false);
  });

  it('rejects an address containing lowercase letters', () => {
    expect(isValidStellarAddress(`G${'a'.repeat(55)}`)).toBe(false);
  });

  it('rejects an address containing spaces', () => {
    expect(isValidStellarAddress(`G${' '.repeat(55)}`)).toBe(false);
  });

  it('rejects an empty string', () => {
    expect(isValidStellarAddress('')).toBe(false);
  });

  it('rejects null', () => {
    expect(isValidStellarAddress(null)).toBe(false);
  });

  it('rejects undefined', () => {
    expect(isValidStellarAddress(undefined)).toBe(false);
  });

  it('rejects a number', () => {
    expect(isValidStellarAddress(12345)).toBe(false);
  });

  it('rejects an object', () => {
    expect(isValidStellarAddress({})).toBe(false);
  });
});
