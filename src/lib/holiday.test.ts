import { expect } from 'chai';
import { HolidayChecker } from './holiday';

describe('HolidayChecker', () => {
    it('returns false for every date when no country is configured', () => {
        const checker = new HolidayChecker(undefined);
        expect(checker.isPublicHoliday(new Date(2026, 0, 1))).to.equal(false);
    });

    it('recognizes New Year\u2019s Day as a public holiday in every German federal state', () => {
        const checker = new HolidayChecker('DE', 'NI');
        expect(checker.isPublicHoliday(new Date(2026, 0, 1))).to.equal(true);
    });

    it('does not treat a regular working day as a public holiday', () => {
        const checker = new HolidayChecker('DE', 'NI');
        expect(checker.isPublicHoliday(new Date(2026, 6, 15))).to.equal(false);
    });

    it('works for a country other than Germany (US Independence Day)', () => {
        const checker = new HolidayChecker('US');
        expect(checker.isPublicHoliday(new Date(2026, 6, 4))).to.equal(true);
    });

    it('narrows down to a specific subdivision of a non-German country (California)', () => {
        const checker = new HolidayChecker('US', 'CA');
        // California-specific holiday not observed nationwide.
        expect(checker.isPublicHoliday(new Date(2026, 2, 31))).to.equal(false);
    });

    it('falls back to nationwide holidays when a country has no state configured', () => {
        const checker = new HolidayChecker('FR');
        expect(checker.isPublicHoliday(new Date(2026, 6, 14))).to.equal(true); // Bastille Day
    });

    describe('getCountries', () => {
        it('includes Germany, the US and France among the supported countries', () => {
            const countries = HolidayChecker.getCountries();
            expect(countries).to.have.property('DE');
            expect(countries).to.have.property('US');
            expect(countries).to.have.property('FR');
        });
    });

    describe('getStates', () => {
        it('returns the German federal states', () => {
            const states = HolidayChecker.getStates('DE');
            expect(states).to.have.property('NI');
            expect(states).to.have.property('BY');
            expect(Object.keys(states).length).to.be.greaterThan(10);
        });

        it('returns US states', () => {
            const states = HolidayChecker.getStates('US');
            expect(states).to.have.property('CA');
        });

        it('returns an empty object for a country without known subdivisions', () => {
            const states = HolidayChecker.getStates('nonexistent-country-code');
            expect(states).to.deep.equal({});
        });
    });
});
