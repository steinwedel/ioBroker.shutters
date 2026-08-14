import { expect } from 'chai';
import { evaluateSunProtection, isSunProtectionEligible, isWithinTimeWindow } from './sun-protection';

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

    describe('isSunProtectionEligible', () => {
        it('requires global and covering enable, summer, an open schedule and the local time window', () => {
            expect(isSunProtectionEligible(true, true, true, true, true, false)).to.equal(true);
            expect(isSunProtectionEligible(false, true, true, true, true, false)).to.equal(false);
            expect(isSunProtectionEligible(true, false, true, true, true, false)).to.equal(false);
            expect(isSunProtectionEligible(true, true, false, true, true, false)).to.equal(false);
            expect(isSunProtectionEligible(true, true, true, false, true, false)).to.equal(false);
            expect(isSunProtectionEligible(true, true, true, true, false, false)).to.equal(false);
            expect(isSunProtectionEligible(true, true, true, true, true, true)).to.equal(false);
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
