import { expect } from 'chai';
import { coveringToRuntime, DEFAULT_CALIBRATION_CURVE, normalizeCurve, runtimeToCovering } from './position-mapping';

describe('position-mapping', () => {
    describe('normalizeCurve', () => {
        it('falls back to the identity curve when undefined', () => {
            expect(normalizeCurve(undefined)).to.deep.equal(DEFAULT_CALIBRATION_CURVE);
        });

        it('falls back to the identity curve when it has fewer than 2 points', () => {
            expect(normalizeCurve([{ coveringPercent: 0, runtimePercent: 0 }])).to.deep.equal(
                DEFAULT_CALIBRATION_CURVE,
            );
        });

        it('falls back to the identity curve when it does not span 0-100', () => {
            const curve = [
                { coveringPercent: 10, runtimePercent: 0 },
                { coveringPercent: 90, runtimePercent: 100 },
            ];
            expect(normalizeCurve(curve)).to.deep.equal(DEFAULT_CALIBRATION_CURVE);
        });

        it('sorts unsorted points by coveringPercent', () => {
            const curve = [
                { coveringPercent: 100, runtimePercent: 100 },
                { coveringPercent: 0, runtimePercent: 0 },
                { coveringPercent: 50, runtimePercent: 20 },
            ];
            const result = normalizeCurve(curve);
            expect(result.map(p => p.coveringPercent)).to.deep.equal([0, 50, 100]);
        });
    });

    describe('coveringToRuntime / runtimeToCovering with identity curve', () => {
        const curve = DEFAULT_CALIBRATION_CURVE;

        it('maps 1:1', () => {
            expect(coveringToRuntime(0, curve)).to.equal(0);
            expect(coveringToRuntime(50, curve)).to.equal(50);
            expect(coveringToRuntime(100, curve)).to.equal(100);
            expect(runtimeToCovering(30, curve)).to.equal(30);
        });

        it('clamps out-of-range input', () => {
            expect(coveringToRuntime(-10, curve)).to.equal(0);
            expect(coveringToRuntime(150, curve)).to.equal(100);
        });
    });

    describe('coveringToRuntime / runtimeToCovering with a non-linear curve', () => {
        // The last 20% of covering height take 50% of the runtime (e.g. the
        // final closing phase of a roller shutter is disproportionately slow).
        const curve = normalizeCurve([
            { coveringPercent: 0, runtimePercent: 0 },
            { coveringPercent: 80, runtimePercent: 50 },
            { coveringPercent: 100, runtimePercent: 100 },
        ]);

        it('interpolates within the first segment', () => {
            expect(coveringToRuntime(40, curve)).to.equal(25);
        });

        it('interpolates within the second segment', () => {
            expect(coveringToRuntime(90, curve)).to.equal(75);
        });

        it('is the exact inverse of runtimeToCovering at the calibration points', () => {
            for (const point of curve) {
                expect(coveringToRuntime(point.coveringPercent, curve)).to.equal(point.runtimePercent);
                expect(runtimeToCovering(point.runtimePercent, curve)).to.equal(point.coveringPercent);
            }
        });
    });
});
