import { expect } from 'chai';
import { BelowThresholdHysteresis } from './generic-hysteresis';

describe('BelowThresholdHysteresis', () => {
    it('returns false immediately when the value is at/above the threshold', () => {
        const h = new BelowThresholdHysteresis();
        expect(h.update(200, 150, 10_000, 0)).to.equal(false);
    });

    it('returns false when the value is undefined', () => {
        const h = new BelowThresholdHysteresis();
        expect(h.update(undefined, 150, 10_000, 0)).to.equal(false);
    });

    it('returns false while below the threshold but before minDurationMs has elapsed', () => {
        const h = new BelowThresholdHysteresis();
        expect(h.update(100, 150, 10_000, 0)).to.equal(false);
        expect(h.update(100, 150, 10_000, 5_000)).to.equal(false);
    });

    it('returns true once continuously below the threshold for at least minDurationMs', () => {
        const h = new BelowThresholdHysteresis();
        h.update(100, 150, 10_000, 0);
        expect(h.update(100, 150, 10_000, 10_000)).to.equal(true);
    });

    it('resets the timer if the value rises back above the threshold in between', () => {
        const h = new BelowThresholdHysteresis();
        h.update(100, 150, 10_000, 0);
        h.update(200, 150, 10_000, 5_000); // rises above threshold - resets
        expect(h.update(100, 150, 10_000, 10_000)).to.equal(false);
        expect(h.update(100, 150, 10_000, 20_000)).to.equal(true);
    });
});
