import { expect } from 'chai';
import { computeSunEventTime, getSunPosition } from './twilight';

// Hannover-ish coordinates; used only as a stable, non-polar reference location.
const LATITUDE = 52.37;
const LONGITUDE = 9.73;
const date = new Date(2026, 5, 21); // 2026-06-21, summer solstice - stable sunrise/sunset for this latitude

describe('twilight', () => {
    describe('computeSunEventTime', () => {
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

        it('computes civil dawn earlier than sunrise on the same day', () => {
            const dawn = computeSunEventTime(date, LATITUDE, LONGITUDE, 'dawn', 0)!;
            const sunrise = computeSunEventTime(date, LATITUDE, LONGITUDE, 'sunrise', 0)!;
            expect(dawn.getTime()).to.be.lessThan(sunrise.getTime());
        });

        it('computes civil dusk later than sunset on the same day', () => {
            const dusk = computeSunEventTime(date, LATITUDE, LONGITUDE, 'dusk', 0)!;
            const sunset = computeSunEventTime(date, LATITUDE, LONGITUDE, 'sunset', 0)!;
            expect(dusk.getTime()).to.be.greaterThan(sunset.getTime());
        });

        it('applies an offset to a dusk time', () => {
            const base = computeSunEventTime(date, LATITUDE, LONGITUDE, 'dusk', 0)!;
            const offset = computeSunEventTime(date, LATITUDE, LONGITUDE, 'dusk', 30)!;
            expect(offset.getTime()).to.equal(base.getTime() + 30 * 60_000);
        });
    });

    describe('getSunPosition', () => {
        it('reports an azimuth close to 180° (South) at solar noon, confirming the North-clockwise convention', () => {
            // Use the midpoint between sunrise and sunset as an approximation of solar noon.
            const sunrise = computeSunEventTime(date, LATITUDE, LONGITUDE, 'sunrise', 0)!;
            const sunset = computeSunEventTime(date, LATITUDE, LONGITUDE, 'sunset', 0)!;
            const noon = new Date((sunrise.getTime() + sunset.getTime()) / 2);

            const position = getSunPosition(noon, LATITUDE, LONGITUDE);
            expect(position.azimuthDeg).to.be.closeTo(180, 5);
            expect(position.elevationDeg).to.be.greaterThan(0);
        });

        it('reports an azimuth below 180° in the morning (East-ish) and above 180° in the afternoon (West-ish)', () => {
            const sunrise = computeSunEventTime(date, LATITUDE, LONGITUDE, 'sunrise', 0)!;
            const sunset = computeSunEventTime(date, LATITUDE, LONGITUDE, 'sunset', 0)!;
            const morning = new Date(sunrise.getTime() + 30 * 60_000);
            const afternoon = new Date(sunset.getTime() - 30 * 60_000);

            expect(getSunPosition(morning, LATITUDE, LONGITUDE).azimuthDeg).to.be.lessThan(180);
            expect(getSunPosition(afternoon, LATITUDE, LONGITUDE).azimuthDeg).to.be.greaterThan(180);
        });

        it('reports a negative elevation at night', () => {
            const midnight = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 2, 0, 0, 0);
            expect(getSunPosition(midnight, LATITUDE, LONGITUDE).elevationDeg).to.be.lessThan(0);
        });
    });
});
