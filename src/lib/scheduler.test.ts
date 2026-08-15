import { expect } from 'chai';
import {
    parseScheduleEntry,
    parseTimeToday,
    pickSunOffsetCappedTarget,
    resolveDaySchedule,
    Scheduler,
} from './scheduler';
import type { IAreaScheduleConfig } from './types';

/** Minimal fake adapter exposing only what `Scheduler` needs for `resolveCurrentAction()` (no timers involved). */
function createFakeAdapter(): ioBroker.Adapter {
    return { log: { warn: () => {} } } as unknown as ioBroker.Adapter;
}

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
            expect(entry).to.deep.equal({ kind: 'sunOffset', minutes: -30, useTwilight: false });
        });

        it('parses a positive plain-minutes offset', () => {
            const entry = parseScheduleEntry('+90', now);
            expect(entry).to.deep.equal({ kind: 'sunOffset', minutes: 90, useTwilight: false });
        });

        it('parses a negative "HH:MM" duration offset', () => {
            const entry = parseScheduleEntry('-00:30', now);
            expect(entry).to.deep.equal({ kind: 'sunOffset', minutes: -30, useTwilight: false });
        });

        it('parses a positive "HH:MM" duration offset', () => {
            const entry = parseScheduleEntry('+01:30', now);
            expect(entry).to.deep.equal({ kind: 'sunOffset', minutes: 90, useTwilight: false });
        });

        it('trims surrounding whitespace', () => {
            const entry = parseScheduleEntry('  +15  ', now);
            expect(entry).to.deep.equal({ kind: 'sunOffset', minutes: 15, useTwilight: false });
        });

        it('returns undefined for garbage input', () => {
            expect(parseScheduleEntry('not a time', now)).to.be.undefined;
        });

        it('returns undefined for a sign without digits', () => {
            expect(parseScheduleEntry('+', now)).to.be.undefined;
        });

        it('parses a plain-minutes offset with a trailing "d" as dawn/dusk-coupled', () => {
            const entry = parseScheduleEntry('-30d', now);
            expect(entry).to.deep.equal({ kind: 'sunOffset', minutes: -30, useTwilight: true });
        });

        it('parses an "HH:MM" duration offset with a trailing "d" as dawn/dusk-coupled', () => {
            const entry = parseScheduleEntry('+01:30d', now);
            expect(entry).to.deep.equal({ kind: 'sunOffset', minutes: 90, useTwilight: true });
        });

        it('accepts an uppercase "D" modifier', () => {
            const entry = parseScheduleEntry('+30D', now);
            expect(entry).to.deep.equal({ kind: 'sunOffset', minutes: 30, useTwilight: true });
        });

        it('parses a plain-minutes offset with a cap time ("+30!19:00")', () => {
            const entry = parseScheduleEntry('+30!19:00', now);
            expect(entry).to.not.be.undefined;
            expect(entry!.kind).to.equal('sunOffsetCapped');
            const capped = entry as { kind: 'sunOffsetCapped'; minutes: number; useTwilight: boolean; capTime: Date };
            expect(capped.minutes).to.equal(30);
            expect(capped.useTwilight).to.equal(false);
            expect(capped.capTime.getHours()).to.equal(19);
            expect(capped.capTime.getMinutes()).to.equal(0);
        });

        it('parses a negative offset with a cap time', () => {
            const entry = parseScheduleEntry('-01:30!07:00', now);
            expect(entry).to.not.be.undefined;
            const capped = entry as { kind: 'sunOffsetCapped'; minutes: number; useTwilight: boolean; capTime: Date };
            expect(capped.kind).to.equal('sunOffsetCapped');
            expect(capped.minutes).to.equal(-90);
            expect(capped.capTime.getHours()).to.equal(7);
        });

        it('parses a dawn/dusk-coupled offset with a cap time ("+30d!19:00")', () => {
            const entry = parseScheduleEntry('+30d!19:00', now);
            expect(entry).to.not.be.undefined;
            const capped = entry as { kind: 'sunOffsetCapped'; minutes: number; useTwilight: boolean; capTime: Date };
            expect(capped.kind).to.equal('sunOffsetCapped');
            expect(capped.minutes).to.equal(30);
            expect(capped.useTwilight).to.equal(true);
            expect(capped.capTime.getHours()).to.equal(19);
        });

        it('trims whitespace around the offset and cap tokens', () => {
            const entry = parseScheduleEntry(' +30 ! 19:00 ', now);
            const capped = entry as { kind: 'sunOffsetCapped'; minutes: number; useTwilight: boolean; capTime: Date };
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

    describe('resolveDaySchedule', () => {
        const monday = new Date(2026, 6, 13, 10, 0, 0, 0); // 2026-07-13 is a Monday
        const saturday = new Date(2026, 6, 18, 10, 0, 0, 0); // Saturday
        const sunday = new Date(2026, 6, 19, 10, 0, 0, 0); // Sunday

        describe('mode "weekdayWeekend" (also the default when scheduleMode is undefined)', () => {
            const area: IAreaScheduleConfig = {
                name: 'Terrace',
                weekday: { open: '07:00', close: '19:00' },
                weekend: { open: '09:00', close: '20:00' },
                holiday: { open: '10:00', close: '20:30' },
            };

            it('returns the holiday schedule when today is a public holiday', () => {
                expect(resolveDaySchedule(area, monday, true)).to.deep.equal(area.holiday);
            });

            it('returns the weekday schedule on a regular weekday', () => {
                expect(resolveDaySchedule(area, monday, false)).to.deep.equal(area.weekday);
            });

            it('returns the weekend schedule on a weekend day', () => {
                expect(resolveDaySchedule(area, saturday, false)).to.deep.equal(area.weekend);
                expect(resolveDaySchedule(area, sunday, false)).to.deep.equal(area.weekend);
            });

            it('defaults to this mode when scheduleMode is undefined', () => {
                expect(area.scheduleMode).to.be.undefined;
                expect(resolveDaySchedule(area, saturday, false)).to.deep.equal(area.weekend);
            });

            it('falls back to weekend on a public holiday when holiday is undefined', () => {
                const areaWithoutHoliday: IAreaScheduleConfig = {
                    name: 'Kitchen',
                    scheduleMode: 'weekdayWeekend',
                    weekday: { open: '06:30', close: '18:30' },
                    weekend: { open: '08:00', close: '20:00' },
                };
                expect(resolveDaySchedule(areaWithoutHoliday, monday, true)).to.deep.equal(areaWithoutHoliday.weekend);
            });
        });

        describe('mode "uniform"', () => {
            const area: IAreaScheduleConfig = {
                name: 'Garage',
                scheduleMode: 'uniform',
                weekday: { open: '07:00', close: '19:00' },
                weekend: { open: '09:00', close: '20:00' }, // unused in this mode
                holiday: { open: '10:00', close: '20:30' }, // unused in this mode
            };

            it('always returns the weekday schedule, ignoring weekend', () => {
                expect(resolveDaySchedule(area, saturday, false)).to.deep.equal(area.weekday);
                expect(resolveDaySchedule(area, sunday, false)).to.deep.equal(area.weekday);
            });

            it('always returns the weekday schedule, ignoring holiday', () => {
                expect(resolveDaySchedule(area, monday, true)).to.deep.equal(area.weekday);
            });
        });

        describe('mode "perWeekday"', () => {
            const area: IAreaScheduleConfig = {
                name: 'Terrace',
                scheduleMode: 'perWeekday',
                weekday: { open: '07:00', close: '19:00' }, // unused in this mode
                weekend: { open: '09:00', close: '20:00' }, // unused in this mode
                holiday: { open: '10:00', close: '20:30' },
                days: {
                    monday: { open: '06:45', close: '18:00' },
                    saturday: { open: '08:00', close: '21:00' },
                },
            };

            it('returns the holiday schedule when today is a public holiday, even with a per-weekday entry set', () => {
                expect(resolveDaySchedule(area, monday, true)).to.deep.equal(area.holiday);
            });

            it("returns the given weekday's own entry", () => {
                expect(resolveDaySchedule(area, monday, false)).to.deep.equal(area.days!.monday);
                expect(resolveDaySchedule(area, saturday, false)).to.deep.equal(area.days!.saturday);
            });

            it('returns an empty schedule (skipping both actions) for a weekday with no entry', () => {
                const tuesday = new Date(2026, 6, 14, 10, 0, 0, 0);
                expect(resolveDaySchedule(area, tuesday, false)).to.deep.equal({});
            });

            it("falls back to today's own weekday entry on a public holiday when holiday is undefined", () => {
                const areaWithoutHoliday: IAreaScheduleConfig = {
                    name: 'Kitchen',
                    scheduleMode: 'perWeekday',
                    weekday: {},
                    weekend: {},
                    days: { monday: { open: '06:30', close: '18:30' } },
                };
                expect(resolveDaySchedule(areaWithoutHoliday, monday, true)).to.deep.equal({
                    open: '06:30',
                    close: '18:30',
                });
            });

            it('returns an empty schedule when days is undefined entirely', () => {
                const areaWithoutDays: IAreaScheduleConfig = {
                    name: 'Kitchen',
                    scheduleMode: 'perWeekday',
                    weekday: {},
                    weekend: {},
                };
                expect(resolveDaySchedule(areaWithoutDays, monday, false)).to.deep.equal({});
            });
        });
    });

    describe('Scheduler.resolveCurrentAction', () => {
        const area: IAreaScheduleConfig = {
            id: 'area1',
            name: 'Living room',
            scheduleMode: 'uniform',
            weekday: { open: '07:30', close: '21:00' },
            weekend: {},
        };

        function createScheduler(): Scheduler {
            return new Scheduler(
                createFakeAdapter(),
                [area],
                () => false,
                undefined,
                () => {},
            );
        }

        it("returns undefined before today's opening time", () => {
            const beforeOpen = new Date(2026, 6, 15, 6, 0, 0, 0);
            expect(createScheduler().resolveCurrentAction(area, beforeOpen)).to.be.undefined;
        });

        it("returns 'open' once today's opening time has passed", () => {
            const afterOpen = new Date(2026, 6, 15, 8, 0, 0, 0);
            expect(createScheduler().resolveCurrentAction(area, afterOpen)).to.equal('open');
        });

        it("returns 'close' once today's closing time has also passed", () => {
            const afterClose = new Date(2026, 6, 15, 22, 0, 0, 0);
            expect(createScheduler().resolveCurrentAction(area, afterClose)).to.equal('close');
        });

        it('returns undefined when neither action is scheduled today', () => {
            const emptyArea: IAreaScheduleConfig = {
                id: 'area2',
                name: 'Empty',
                scheduleMode: 'uniform',
                weekday: {},
                weekend: {},
            };
            const scheduler = new Scheduler(
                createFakeAdapter(),
                [emptyArea],
                () => false,
                undefined,
                () => {},
            );
            const noon = new Date(2026, 6, 15, 12, 0, 0, 0);
            expect(scheduler.resolveCurrentAction(emptyArea, noon)).to.be.undefined;
        });

        it('picks whichever already-past time is most recent, regardless of open/close order', () => {
            // An unusual schedule where "close" (e.g. a midday break) is earlier than "open" again later.
            const reversedArea: IAreaScheduleConfig = {
                id: 'area3',
                name: 'Shop',
                scheduleMode: 'uniform',
                weekday: { open: '14:00', close: '12:00' },
                weekend: {},
            };
            const scheduler = new Scheduler(
                createFakeAdapter(),
                [reversedArea],
                () => false,
                undefined,
                () => {},
            );
            expect(scheduler.resolveCurrentAction(reversedArea, new Date(2026, 6, 15, 13, 0, 0, 0))).to.equal('close');
            expect(scheduler.resolveCurrentAction(reversedArea, new Date(2026, 6, 15, 15, 0, 0, 0))).to.equal('open');
        });
    });

    describe('Scheduler iCal overrides (plan section 5.1)', () => {
        const area: IAreaScheduleConfig = {
            id: 'area1',
            name: 'Kinderzimmer',
            scheduleMode: 'uniform',
            weekday: { open: '07:30', close: '21:00' },
            weekend: {},
        };

        it('applies a matching global override on top of the resolved day schedule', () => {
            const scheduler = new Scheduler(
                createFakeAdapter(),
                [area],
                () => false,
                undefined,
                () => {},
                () => [{ areaName: undefined, action: 'open', time: '06:00' }],
            );

            // The regular schedule would only report 'open' from 07:30; the override moves it to 06:00.
            expect(scheduler.resolveCurrentAction(area, new Date(2026, 6, 15, 6, 30, 0, 0))).to.equal('open');
        });

        it('does not apply an override targeting a different area', () => {
            const scheduler = new Scheduler(
                createFakeAdapter(),
                [area],
                () => false,
                undefined,
                () => {},
                () => [{ areaName: 'Wohnzimmer', action: 'open', time: '06:00' }],
            );

            expect(scheduler.resolveCurrentAction(area, new Date(2026, 6, 15, 6, 30, 0, 0))).to.be.undefined;
        });

        it('behaves exactly like no override at all when the callback is omitted', () => {
            const scheduler = new Scheduler(
                createFakeAdapter(),
                [area],
                () => false,
                undefined,
                () => {},
            );

            expect(scheduler.resolveCurrentAction(area, new Date(2026, 6, 15, 8, 0, 0, 0))).to.equal('open');
        });
    });
});
