import { expect } from 'chai';
import { HolidayChecker } from './holiday';

describe('HolidayChecker', () => {
    it('returns false for every date when no federal state is configured', () => {
        const checker = new HolidayChecker(undefined);
        expect(checker.isPublicHoliday(new Date(2026, 0, 1))).to.equal(false);
    });

    it('recognizes New Year\u2019s Day as a public holiday in every German federal state', () => {
        const checker = new HolidayChecker('NI');
        expect(checker.isPublicHoliday(new Date(2026, 0, 1))).to.equal(true);
    });

    it('does not treat a regular working day as a public holiday', () => {
        const checker = new HolidayChecker('NI');
        expect(checker.isPublicHoliday(new Date(2026, 6, 15))).to.equal(false);
    });
});
