import { expect } from 'chai';
import { evaluateRainProtection, type IRainProtectionInputs } from './rain-protection';

/**
 * @param overrides - Fields to override on top of a minimal "rain, no wind-direction filter configured" baseline.
 */
function makeInputs(overrides: Partial<IRainProtectionInputs> = {}): IRainProtectionInputs {
    return {
        rain: true,
        windSpeedKmh: 10,
        minWindSpeedForDirectionKmh: 0,
        windDirectionDeg: undefined,
        orientationDeg: undefined,
        windDirectionToleranceDeg: undefined,
        ...overrides,
    };
}

describe('rain-protection', () => {
    it('is inactive without rain, regardless of anything else', () => {
        expect(
            evaluateRainProtection(
                makeInputs({ rain: false, windDirectionDeg: 180, orientationDeg: 180, windDirectionToleranceDeg: 45 }),
            ),
        ).to.equal(false);
        expect(evaluateRainProtection(makeInputs({ rain: undefined }))).to.equal(false);
    });

    it('protects on any rain when no wind-direction filter is configured (previous, backwards-compatible behavior)', () => {
        expect(evaluateRainProtection(makeInputs())).to.equal(true);
    });

    describe('optional wind-direction filter (plan section 7)', () => {
        it('protects when the wind blows straight toward the window (matches orientation exactly)', () => {
            expect(
                evaluateRainProtection(
                    makeInputs({
                        windSpeedKmh: 10,
                        windDirectionDeg: 180,
                        orientationDeg: 180,
                        windDirectionToleranceDeg: 45,
                    }),
                ),
            ).to.equal(true);
        });

        it('protects exactly at the tolerance boundary on either side', () => {
            expect(
                evaluateRainProtection(
                    makeInputs({ windDirectionDeg: 135, orientationDeg: 180, windDirectionToleranceDeg: 45 }),
                ),
            ).to.equal(true);
            expect(
                evaluateRainProtection(
                    makeInputs({ windDirectionDeg: 225, orientationDeg: 180, windDirectionToleranceDeg: 45 }),
                ),
            ).to.equal(true);
        });

        it('does not protect once the wind direction is just outside the tolerance on either side', () => {
            expect(
                evaluateRainProtection(
                    makeInputs({ windDirectionDeg: 134, orientationDeg: 180, windDirectionToleranceDeg: 45 }),
                ),
            ).to.equal(false);
            expect(
                evaluateRainProtection(
                    makeInputs({ windDirectionDeg: 226, orientationDeg: 180, windDirectionToleranceDeg: 45 }),
                ),
            ).to.equal(false);
        });

        it('handles wraparound near 0°/360° correctly', () => {
            expect(
                evaluateRainProtection(
                    makeInputs({ windDirectionDeg: 350, orientationDeg: 0, windDirectionToleranceDeg: 20 }),
                ),
            ).to.equal(true);
            expect(
                evaluateRainProtection(
                    makeInputs({ windDirectionDeg: 100, orientationDeg: 0, windDirectionToleranceDeg: 20 }),
                ),
            ).to.equal(false);
        });

        it('falls back to protecting unconditionally when orientation is not configured, even with a tolerance set', () => {
            expect(
                evaluateRainProtection(
                    makeInputs({ windDirectionDeg: 0, orientationDeg: undefined, windDirectionToleranceDeg: 20 }),
                ),
            ).to.equal(true);
        });

        it('does not protect when the wind direction reading is unavailable, even with a filter configured', () => {
            expect(
                evaluateRainProtection(
                    makeInputs({ windDirectionDeg: undefined, orientationDeg: 180, windDirectionToleranceDeg: 45 }),
                ),
            ).to.equal(false);
        });

        it('applies the direction filter only at or above the configured minimum wind speed, and does not protect below it', () => {
            expect(
                evaluateRainProtection(
                    makeInputs({
                        windSpeedKmh: 9.9,
                        minWindSpeedForDirectionKmh: 10,
                        windDirectionDeg: 0,
                        orientationDeg: 180,
                        windDirectionToleranceDeg: 45,
                    }),
                ),
            ).to.equal(false);
            expect(
                evaluateRainProtection(
                    makeInputs({
                        windSpeedKmh: 10,
                        minWindSpeedForDirectionKmh: 10,
                        windDirectionDeg: 0,
                        orientationDeg: 180,
                        windDirectionToleranceDeg: 45,
                    }),
                ),
            ).to.equal(false);
        });

        it('does not protect when wind speed is unavailable, even with a filter configured', () => {
            expect(
                evaluateRainProtection(
                    makeInputs({
                        windSpeedKmh: undefined,
                        minWindSpeedForDirectionKmh: 0,
                        windDirectionDeg: 0,
                        orientationDeg: 180,
                        windDirectionToleranceDeg: 45,
                    }),
                ),
            ).to.equal(false);
        });
    });
});
