import { expect } from 'chai';
import { applyIcalOverrides, parseIcalOverrideTitle, resolveIcalOverridesForDay } from './ical';
import type { IAreaScheduleConfig } from './types';

describe('ical', () => {
    describe('parseIcalOverrideTitle', () => {
        it('parses a global "auf" (open) override without an area name', () => {
            expect(parseIcalOverrideTitle('Rolläden auf 07:00', 'Rolläden')).to.deep.equal({
                areaName: undefined,
                action: 'open',
                time: '07:00',
            });
        });

        it('parses a global "zu" (close) override without an area name', () => {
            expect(parseIcalOverrideTitle('Rolläden zu 21:00', 'Rolläden')).to.deep.equal({
                areaName: undefined,
                action: 'close',
                time: '21:00',
            });
        });

        it('parses an area-scoped override with a colon separator', () => {
            expect(parseIcalOverrideTitle('Rolläden: Kinderzimmer auf 07:00', 'Rolläden')).to.deep.equal({
                areaName: 'Kinderzimmer',
                action: 'open',
                time: '07:00',
            });
        });

        it('parses an area-scoped override with a dash separator', () => {
            expect(parseIcalOverrideTitle('Rolläden - Kinderzimmer zu 20:30', 'Rolläden')).to.deep.equal({
                areaName: 'Kinderzimmer',
                action: 'close',
                time: '20:30',
            });
        });

        it('parses an area-scoped override with an en dash separator', () => {
            expect(parseIcalOverrideTitle('Rolläden – Kinderzimmer auf 07:00', 'Rolläden')).to.deep.equal({
                areaName: 'Kinderzimmer',
                action: 'open',
                time: '07:00',
            });
        });

        it('matches the prefix and keyword case-insensitively', () => {
            expect(parseIcalOverrideTitle('rolläden AUF 07:00', 'Rolläden')).to.deep.equal({
                areaName: undefined,
                action: 'open',
                time: '07:00',
            });
        });

        it('accepts a single-digit hour', () => {
            expect(parseIcalOverrideTitle('Rolläden auf 7:05', 'Rolläden')).to.deep.equal({
                areaName: undefined,
                action: 'open',
                time: '7:05',
            });
        });

        it('returns undefined for a title with the wrong prefix', () => {
            expect(parseIcalOverrideTitle('Urlaub auf 07:00', 'Rolläden')).to.be.undefined;
        });

        it('returns undefined for an unrelated event title', () => {
            expect(parseIcalOverrideTitle('Zahnarzttermin', 'Rolläden')).to.be.undefined;
        });

        it('returns undefined for a missing keyword', () => {
            expect(parseIcalOverrideTitle('Rolläden 07:00', 'Rolläden')).to.be.undefined;
        });

        it('returns undefined for an invalid time', () => {
            expect(parseIcalOverrideTitle('Rolläden auf 25:99', 'Rolläden')).to.be.undefined;
        });

        it('returns undefined when the configured prefix is blank', () => {
            expect(parseIcalOverrideTitle('Rolläden auf 07:00', '  ')).to.be.undefined;
        });
    });

    describe('resolveIcalOverridesForDay', () => {
        const today = new Date(2026, 6, 15, 10, 0, 0, 0);

        it('includes an event whose title matches and whose _date falls on the given day', () => {
            const overrides = resolveIcalOverridesForDay(
                [{ event: 'Rolläden auf 07:00', _date: new Date(2026, 6, 15, 0, 0, 0, 0).toISOString() }],
                'Rolläden',
                today,
            );
            expect(overrides).to.deep.equal([{ areaName: undefined, action: 'open', time: '07:00' }]);
        });

        it('accepts a numeric epoch _date value', () => {
            const overrides = resolveIcalOverridesForDay(
                [{ event: 'Rolläden auf 07:00', _date: new Date(2026, 6, 15, 0, 0, 0, 0).getTime() }],
                'Rolläden',
                today,
            );
            expect(overrides).to.have.length(1);
        });

        it('excludes an event on a different calendar day', () => {
            const overrides = resolveIcalOverridesForDay(
                [{ event: 'Rolläden auf 07:00', _date: new Date(2026, 6, 16, 0, 0, 0, 0).toISOString() }],
                'Rolläden',
                today,
            );
            expect(overrides).to.deep.equal([]);
        });

        it('excludes an event whose title does not match the convention', () => {
            const overrides = resolveIcalOverridesForDay(
                [{ event: 'Zahnarzttermin', _date: new Date(2026, 6, 15, 9, 0, 0, 0).toISOString() }],
                'Rolläden',
                today,
            );
            expect(overrides).to.deep.equal([]);
        });

        it('skips an event with a missing/unparseable _date instead of throwing', () => {
            const overrides = resolveIcalOverridesForDay(
                [{ event: 'Rolläden auf 07:00' }, { event: 'Rolläden zu 21:00', _date: 'not-a-date' }],
                'Rolläden',
                today,
            );
            expect(overrides).to.deep.equal([]);
        });

        it('returns multiple overrides from multiple matching events on the same day', () => {
            const overrides = resolveIcalOverridesForDay(
                [
                    { event: 'Rolläden auf 07:00', _date: new Date(2026, 6, 15, 0, 0, 0, 0).toISOString() },
                    {
                        event: 'Rolläden: Kinderzimmer zu 19:00',
                        _date: new Date(2026, 6, 15, 12, 0, 0, 0).toISOString(),
                    },
                ],
                'Rolläden',
                today,
            );
            expect(overrides).to.deep.equal([
                { areaName: undefined, action: 'open', time: '07:00' },
                { areaName: 'Kinderzimmer', action: 'close', time: '19:00' },
            ]);
        });
    });

    describe('applyIcalOverrides', () => {
        function makeArea(name: string): IAreaScheduleConfig {
            return { id: 'a1', name, weekday: { open: '07:30', close: '19:30' }, weekend: {} };
        }

        it('returns the original schedule unchanged when there are no overrides', () => {
            const daySchedule = { open: '07:30', close: '19:30' };
            expect(applyIcalOverrides(daySchedule, makeArea('Kinderzimmer'), [])).to.deep.equal(daySchedule);
        });

        it('applies a global override to every area, regardless of name', () => {
            const daySchedule = { open: '07:30', close: '19:30' };
            const result = applyIcalOverrides(daySchedule, makeArea('Wohnzimmer'), [
                { areaName: undefined, action: 'open', time: '06:00' },
            ]);
            expect(result).to.deep.equal({ open: '06:00', close: '19:30' });
        });

        it('applies an area-scoped override only to the matching area', () => {
            const daySchedule = { open: '07:30', close: '19:30' };
            const overrides = [{ areaName: 'Kinderzimmer', action: 'open' as const, time: '06:00' }];

            expect(applyIcalOverrides(daySchedule, makeArea('Kinderzimmer'), overrides)).to.deep.equal({
                open: '06:00',
                close: '19:30',
            });
            expect(applyIcalOverrides(daySchedule, makeArea('Wohnzimmer'), overrides)).to.deep.equal(daySchedule);
        });

        it('matches the area name case-insensitively', () => {
            const daySchedule = { open: '07:30', close: '19:30' };
            const result = applyIcalOverrides(daySchedule, makeArea('kinderzimmer'), [
                { areaName: 'KINDERZIMMER', action: 'close', time: '18:00' },
            ]);
            expect(result).to.deep.equal({ open: '07:30', close: '18:00' });
        });

        it('applies both an open and a close override from two separate events', () => {
            const daySchedule = { open: '07:30', close: '19:30' };
            const result = applyIcalOverrides(daySchedule, makeArea('Kinderzimmer'), [
                { areaName: 'Kinderzimmer', action: 'open', time: '06:00' },
                { areaName: 'Kinderzimmer', action: 'close', time: '18:00' },
            ]);
            expect(result).to.deep.equal({ open: '06:00', close: '18:00' });
        });

        it('lets the last override for the same area/action win', () => {
            const daySchedule = { open: '07:30', close: '19:30' };
            const result = applyIcalOverrides(daySchedule, makeArea('Kinderzimmer'), [
                { areaName: 'Kinderzimmer', action: 'open', time: '06:00' },
                { areaName: 'Kinderzimmer', action: 'open', time: '05:30' },
            ]);
            expect(result).to.deep.equal({ open: '05:30', close: '19:30' });
        });
    });
});
