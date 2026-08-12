import { expect } from 'chai';
import { parseScheduleEntry, parseTimeToday } from './scheduler';

describe('scheduler', () => {
    describe('parseTimeToday', () => {
        const now = new Date(2026, 6, 15, 10, 0, 0, 0); // 2026-07-15 10:00 local

        it('parses a valid "HH:MM" time onto the reference date', () => {
            const result = parseTimeToday('7:30', now);
            expect(result).to.not.be.undefined;
            expect(result!.getFullYear()).to.equal(2026);
            expect(result!.getMonth()).to.equal(6);
            expect(result!.getDate()).to.equal(15);
            expect(result!.getHours()).to.equal(7);
            expect(result!.getMinutes()).to.equal(30);
        });

        it('parses zero-padded times', () => {
            const result = parseTimeToday('07:30', now);
            expect(result!.getHours()).to.equal(7);
            expect(result!.getMinutes()).to.equal(30);
        });

        it('parses the last valid hour/minute', () => {
            const result = parseTimeToday('23:59', now);
            expect(result!.getHours()).to.equal(23);
            expect(result!.getMinutes()).to.equal(59);
        });

        it('returns undefined for an invalid hour', () => {
            expect(parseTimeToday('24:00', now)).to.be.undefined;
        });

        it('returns undefined for an invalid minute', () => {
            expect(parseTimeToday('12:60', now)).to.be.undefined;
        });

        it('returns undefined for garbage input', () => {
            expect(parseTimeToday('not a time', now)).to.be.undefined;
        });
    });

    describe('parseScheduleEntry', () => {
        const now = new Date(2026, 6, 15, 10, 0, 0, 0); // 2026-07-15 10:00 local

        it('parses a plain "HH:MM" time as a clock time', () => {
            const entry = parseScheduleEntry('07:30', now);
            expect(entry).to.deep.include({ kind: 'time' });
            expect((entry as { kind: 'time'; time: Date }).time.getHours()).to.equal(7);
            expect((entry as { kind: 'time'; time: Date }).time.getMinutes()).to.equal(30);
        });

        it('parses a negative plain-minutes offset', () => {
            const entry = parseScheduleEntry('-30', now);
            expect(entry).to.deep.equal({ kind: 'sunOffset', minutes: -30 });
        });

        it('parses a positive plain-minutes offset', () => {
            const entry = parseScheduleEntry('+90', now);
            expect(entry).to.deep.equal({ kind: 'sunOffset', minutes: 90 });
        });

        it('parses a negative "HH:MM" duration offset', () => {
            const entry = parseScheduleEntry('-00:30', now);
            expect(entry).to.deep.equal({ kind: 'sunOffset', minutes: -30 });
        });

        it('parses a positive "HH:MM" duration offset', () => {
            const entry = parseScheduleEntry('+01:30', now);
            expect(entry).to.deep.equal({ kind: 'sunOffset', minutes: 90 });
        });

        it('trims surrounding whitespace', () => {
            const entry = parseScheduleEntry('  +15  ', now);
            expect(entry).to.deep.equal({ kind: 'sunOffset', minutes: 15 });
        });

        it('returns undefined for garbage input', () => {
            expect(parseScheduleEntry('not a time', now)).to.be.undefined;
        });

        it('returns undefined for a sign without digits', () => {
            expect(parseScheduleEntry('+', now)).to.be.undefined;
        });
    });
});
