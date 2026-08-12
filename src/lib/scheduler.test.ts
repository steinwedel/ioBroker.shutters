import { expect } from 'chai';
import { parseScheduleEntry, parseTimeToday, pickSunOffsetCappedTarget } from './scheduler';

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

        it('parses a plain-minutes offset with a cap time ("+30!19:00")', () => {
            const entry = parseScheduleEntry('+30!19:00', now);
            expect(entry).to.not.be.undefined;
            expect(entry!.kind).to.equal('sunOffsetCapped');
            const capped = entry as { kind: 'sunOffsetCapped'; minutes: number; capTime: Date };
            expect(capped.minutes).to.equal(30);
            expect(capped.capTime.getHours()).to.equal(19);
            expect(capped.capTime.getMinutes()).to.equal(0);
        });

        it('parses a negative offset with a cap time', () => {
            const entry = parseScheduleEntry('-01:30!07:00', now);
            expect(entry).to.not.be.undefined;
            const capped = entry as { kind: 'sunOffsetCapped'; minutes: number; capTime: Date };
            expect(capped.kind).to.equal('sunOffsetCapped');
            expect(capped.minutes).to.equal(-90);
            expect(capped.capTime.getHours()).to.equal(7);
        });

        it('trims whitespace around the offset and cap tokens', () => {
            const entry = parseScheduleEntry(' +30 ! 19:00 ', now);
            const capped = entry as { kind: 'sunOffsetCapped'; minutes: number; capTime: Date };
            expect(capped.kind).to.equal('sunOffsetCapped');
            expect(capped.minutes).to.equal(30);
            expect(capped.capTime.getHours()).to.equal(19);
        });

        it('returns undefined when the offset part of a capped entry is invalid', () => {
            expect(parseScheduleEntry('19:00!19:00', now)).to.be.undefined;
        });

        it('returns undefined when the cap part of a capped entry is invalid', () => {
            expect(parseScheduleEntry('+30!not-a-time', now)).to.be.undefined;
        });
    });

    describe('pickSunOffsetCappedTarget', () => {
        const capTime = new Date(2026, 6, 15, 19, 0, 0, 0);

        it('picks the sun-relative target when it is earlier than the cap', () => {
            const sunTarget = new Date(2026, 6, 15, 18, 30, 0, 0);
            expect(pickSunOffsetCappedTarget(sunTarget, capTime)).to.equal(sunTarget);
        });

        it('picks the cap when the sun-relative target is later than the cap', () => {
            const sunTarget = new Date(2026, 6, 15, 19, 30, 0, 0);
            expect(pickSunOffsetCappedTarget(sunTarget, capTime)).to.equal(capTime);
        });

        it('picks the cap when the sun-relative target equals the cap', () => {
            const sunTarget = new Date(capTime.getTime());
            expect(pickSunOffsetCappedTarget(sunTarget, capTime)).to.equal(capTime);
        });

        it('picks the cap when the sun-relative target could not be computed', () => {
            expect(pickSunOffsetCappedTarget(undefined, capTime)).to.equal(capTime);
        });
    });
});
