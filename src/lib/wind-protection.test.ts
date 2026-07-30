import { expect } from 'chai';
import { evaluateWindProtection } from './wind-protection';

describe('wind-protection', () => {
    it('activates once wind speed reaches the threshold', () => {
        expect(
            evaluateWindProtection({ windSpeed: 40, openThreshold: 40, calmAllowed: false, wasActive: false }),
        ).to.equal(true);
    });

    it('deactivates once calm hysteresis is satisfied', () => {
        expect(
            evaluateWindProtection({ windSpeed: 10, openThreshold: 40, calmAllowed: true, wasActive: true }),
        ).to.equal(false);
    });

    it('holds the previous state while calm hysteresis is not satisfied yet', () => {
        expect(
            evaluateWindProtection({ windSpeed: 10, openThreshold: 40, calmAllowed: false, wasActive: true }),
        ).to.equal(true);
    });

    it('holds the previous state when wind speed is unavailable', () => {
        expect(
            evaluateWindProtection({ windSpeed: undefined, openThreshold: 40, calmAllowed: false, wasActive: true }),
        ).to.equal(true);
    });
});
