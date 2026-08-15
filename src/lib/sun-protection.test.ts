import { expect } from 'chai';
import {
    evaluateSunProtection,
    isHeatProtectionMinTempSatisfied,
    isSunProtectionEligible,
    isSunProtectionTriggeredByCloudCover,
    isWithinOrientationWindow,
    isWithinTimeWindow,
} from './sun-protection';

describe('sun-protection', () => {
    describe('isWithinTimeWindow', () => {
        const noon = new Date(2026, 6, 15, 12, 0, 0, 0);

        it('returns true when no window is configured', () => {
            expect(isWithinTimeWindow(noon, undefined, undefined)).to.equal(true);
        });

        it('returns true when now is inside the window', () => {
            expect(isWithinTimeWindow(noon, '10:00', '16:00')).to.equal(true);
        });

        it('returns false when now is before the window', () => {
            const early = new Date(2026, 6, 15, 8, 0, 0, 0);
            expect(isWithinTimeWindow(early, '10:00', '16:00')).to.equal(false);
        });

        it('returns false when now is at/after the window end (exclusive)', () => {
            const end = new Date(2026, 6, 15, 16, 0, 0, 0);
            expect(isWithinTimeWindow(end, '10:00', '16:00')).to.equal(false);
        });
    });

    describe('isWithinOrientationWindow', () => {
        it('is active when the sun azimuth equals the orientation', () => {
            expect(isWithinOrientationWindow(180, 180, -70, 70)).to.equal(true);
        });

        it('is active exactly at the tolerance boundary on either side', () => {
            expect(isWithinOrientationWindow(110, 180, -70, 70)).to.equal(true);
            expect(isWithinOrientationWindow(250, 180, -70, 70)).to.equal(true);
        });

        it('is inactive just outside the tolerance on either side', () => {
            expect(isWithinOrientationWindow(109, 180, -70, 70)).to.equal(false);
            expect(isWithinOrientationWindow(251, 180, -70, 70)).to.equal(false);
        });

        it('handles wraparound near 0°/360° correctly', () => {
            expect(isWithinOrientationWindow(5, 350, -70, 70)).to.equal(true);
            expect(isWithinOrientationWindow(355, 10, -70, 70)).to.equal(true);
            expect(isWithinOrientationWindow(180, 350, -70, 70)).to.equal(false);
        });

        it('supports independent, asymmetric minus/plus bounds', () => {
            expect(isWithinOrientationWindow(150, 180, -20, 70)).to.equal(false); // -30°, below the -20° minus bound
            expect(isWithinOrientationWindow(170, 180, -20, 70)).to.equal(true); // -10°, within -20°..+70°
            expect(isWithinOrientationWindow(240, 180, -20, 70)).to.equal(true); // +60°, within -20°..+70°
            expect(isWithinOrientationWindow(260, 180, -20, 70)).to.equal(false); // +80°, above the +70° plus bound
        });
    });

    describe('isSunProtectionEligible', () => {
        it('requires global and covering enable, summer, an open schedule, the local time window and the temperature filter', () => {
            expect(isSunProtectionEligible(true, true, true, true, true, false, true)).to.equal(true);
            expect(isSunProtectionEligible(false, true, true, true, true, false, true)).to.equal(false);
            expect(isSunProtectionEligible(true, false, true, true, true, false, true)).to.equal(false);
            expect(isSunProtectionEligible(true, true, false, true, true, false, true)).to.equal(false);
            expect(isSunProtectionEligible(true, true, true, false, true, false, true)).to.equal(false);
            expect(isSunProtectionEligible(true, true, true, true, false, false, true)).to.equal(false);
            expect(isSunProtectionEligible(true, true, true, true, true, true, true)).to.equal(false);
            expect(isSunProtectionEligible(true, true, true, true, true, false, false)).to.equal(false);
        });
    });

    describe('isHeatProtectionMinTempSatisfied (plan section 6.5)', () => {
        it('is always satisfied when no threshold is configured, regardless of temperature', () => {
            expect(isHeatProtectionMinTempSatisfied(5, undefined)).to.equal(true);
            expect(isHeatProtectionMinTempSatisfied(undefined, undefined)).to.equal(true);
        });

        it('is satisfied once the temperature reaches the threshold', () => {
            expect(isHeatProtectionMinTempSatisfied(20, 20)).to.equal(true);
            expect(isHeatProtectionMinTempSatisfied(25, 20)).to.equal(true);
        });

        it('is not satisfied below the threshold', () => {
            expect(isHeatProtectionMinTempSatisfied(19.9, 20)).to.equal(false);
        });

        it('is not satisfied when a threshold is configured but the temperature is unavailable', () => {
            expect(isHeatProtectionMinTempSatisfied(undefined, 20)).to.equal(false);
        });
    });

    describe('isSunProtectionTriggeredByCloudCover (plan section 6.3)', () => {
        it('never triggers when disabled, regardless of how clear the sky is', () => {
            expect(isSunProtectionTriggeredByCloudCover(false, 0, 40)).to.equal(false);
        });

        it('triggers once enabled and cloud cover is at/below the clear-sky threshold', () => {
            expect(isSunProtectionTriggeredByCloudCover(true, 40, 40)).to.equal(true);
            expect(isSunProtectionTriggeredByCloudCover(true, 0, 40)).to.equal(true);
        });

        it('does not trigger once cloud cover rises above the clear-sky threshold', () => {
            expect(isSunProtectionTriggeredByCloudCover(true, 40.1, 40)).to.equal(false);
        });

        it('does not trigger when enabled but cloud cover is unavailable', () => {
            expect(isSunProtectionTriggeredByCloudCover(true, undefined, 40)).to.equal(false);
        });
    });

    describe('evaluateSunProtection', () => {
        it('is never active outside the time window, even at high radiation', () => {
            expect(
                evaluateSunProtection({
                    inWindow: false,
                    solarRadiation: 500,
                    closeThreshold: 200,
                    openAllowed: false,
                    wasActive: true,
                }),
            ).to.equal(false);
        });

        it('activates once radiation reaches the close threshold', () => {
            expect(
                evaluateSunProtection({
                    inWindow: true,
                    solarRadiation: 200,
                    closeThreshold: 200,
                    openAllowed: false,
                    wasActive: false,
                }),
            ).to.equal(true);
        });

        it('deactivates once the open hysteresis is satisfied and radiation is below the close threshold', () => {
            expect(
                evaluateSunProtection({
                    inWindow: true,
                    solarRadiation: 100,
                    closeThreshold: 200,
                    openAllowed: true,
                    wasActive: true,
                }),
            ).to.equal(false);
        });

        it('holds the previous state in the dead zone (below close threshold, open not yet allowed)', () => {
            expect(
                evaluateSunProtection({
                    inWindow: true,
                    solarRadiation: 180,
                    closeThreshold: 200,
                    openAllowed: false,
                    wasActive: true,
                }),
            ).to.equal(true);
            expect(
                evaluateSunProtection({
                    inWindow: true,
                    solarRadiation: 180,
                    closeThreshold: 200,
                    openAllowed: false,
                    wasActive: false,
                }),
            ).to.equal(false);
        });

        it('holds the previous state when radiation is unavailable', () => {
            expect(
                evaluateSunProtection({
                    inWindow: true,
                    solarRadiation: undefined,
                    closeThreshold: 200,
                    openAllowed: false,
                    wasActive: true,
                }),
            ).to.equal(true);
        });
    });
});
