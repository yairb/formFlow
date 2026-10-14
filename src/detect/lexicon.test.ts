import { describe, expect, it } from 'vitest';
import { cleanLabel, isChoiceWord, isOfficeUseText, kindForLabel, labelStrength } from './lexicon';

describe('lexicon', () => {
  it('classifies labels across languages', () => {
    expect(kindForLabel('Date of birth')).toBe('date');
    expect(kindForLabel('Fecha de nacimiento')).toBe('date');
    expect(kindForLabel('תאריך לידה')).toBe('date');
    expect(kindForLabel("Applicant's signature")).toBe('signature');
    expect(kindForLabel('Unterschrift')).toBe('signature');
    expect(kindForLabel('חתימת המבקש')).toBe('signature');
    expect(kindForLabel('Reason for moving')).toBe('multiline');
    expect(kindForLabel('Full name')).toBe('text');
    expect(kindForLabel(null, 'multiline')).toBe('multiline');
  });

  it('matches Latin terms on word boundaries only', () => {
    expect(kindForLabel('Update')).toBe('text'); // contains "date"
    expect(kindForLabel('Designed')).toBe('text'); // contains "sign"
  });

  it('ignores Hebrew niqqud', () => {
    expect(kindForLabel('תַּאֲרִיךְ')).toBe('date');
  });

  it('recognises office-use and option words', () => {
    expect(isOfficeUseText('FOR OFFICE USE ONLY')).toBe(true);
    expect(isOfficeUseText('לשימוש המשרד בלבד')).toBe(true);
    expect(isChoiceWord('Yes')).toBe(true);
    expect(isChoiceWord('לא')).toBe(true);
    expect(isChoiceWord('No smoking allowed in the unit')).toBe(false);
  });

  it('scores label-like text above sentences', () => {
    expect(labelStrength('Phone:')).toBeGreaterThanOrEqual(0.9);
    expect(labelStrength('Employer')).toBeGreaterThan(0.5);
    expect(labelStrength('Thank you for applying to live with us today.')).toBeLessThan(0.3);
    expect(labelStrength('This sentence is far too long to be a field label in any form at all')).toBe(0);
    expect(labelStrength('3.')).toBeLessThan(0.3);
  });

  it('cleans labels for display', () => {
    expect(cleanLabel('Name: ____')).toBe('Name');
    expect(cleanLabel('* Email address :')).toBe('Email address');
  });
});
