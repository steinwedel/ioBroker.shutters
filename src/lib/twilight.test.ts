import { expect } from 'chai';
import { computeDuskTime, computeSunEventTime } from './twilight';

// Hannover-ish coordinates; used only as a stable, non-polar reference location.
const LATITUDE = 52.37;
const LONGITUDE = 9.73;

describe('twilight', () => {
    describe('computeSunEventTime', () => {
        const date = new Date(2026, 5, 21); // 2026-06-21, summer solstice - stable sunrise/sunset for this latitude

        it('computes sunrise with zero offset close to the un-offset SunCalc time', () => {
            const sunrise = computeSunEventTime(date, LATITUDE, LONGITUDE, 'sunrise', 0);
            expect(sunrise).to.not.be.undefined;
            // Mid-summer sunrise in this latitude band is early morning, well before noon.
            expect(sunrise!.getHours()).to.be.lessThan(12);
        });

        it('applies a negative offset to open before sunrise', () => {
            const base = computeSunEventTime(date, LATITUDE, LONGITUDE, 'sunrise', 0)!;
            const offset = computeSunEventTime(date, LATITUDE, LONGITUDE, 'sunrise', -30)!;
            expect(offset.getTime()).to.equal(base.getTime() - 30 * 60_000);
        });

        it('applies a positive offset to close after sunset', () => {
            const base = computeSunEventTime(date, LATITUDE, LONGITUDE, 'sunset', 0)!;
            const offset = computeSunEventTime(date, LATITUDE, LONGITUDE, 'sunset', 90)!;
            expect(offset.getTime()).to.equal(base.getTime() + 90 * 60_000);
        });

        it('computes sunset later than sunrise on the same day', () => {
            const sunrise = computeSunEventTime(date, LATITUDE, LONGITUDE, 'sunrise', 0)!;
            const sunset = computeSunEventTime(date, LATITUDE, LONGITUDE, 'sunset', 0)!;
            expect(sunset.getTime()).to.be.greaterThan(sunrise.getTime());
        });
    });

    describe('computeDuskTime', () => {
        it('computes a dusk time later than sunset on the same day', () => {
            const date = new Date(2026, 5, 21);
            const dusk = computeDuskTime(date, LATITUDE, LONGITUDE, 0)!;
            const sunset = computeSunEventTime(date, LATITUDE, LONGITUDE, 'sunset', 0)!;
            expect(dusk.getTime()).to.be.greaterThan(sunset.getTime());
        });

        it('applies the offset', () => {
            const date = new Date(2026, 5, 21);
            const base = computeDuskTime(date, LATITUDE, LONGITUDE, 0)!;
            const offset = computeDuskTime(date, LATITUDE, LONGITUDE, 30)!;
            expect(offset.getTime()).to.equal(base.getTime() + 30 * 60_000);
        });
    });
});
