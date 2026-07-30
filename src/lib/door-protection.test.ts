import { expect } from 'chai';
import { clampForDoorProtection } from './door-protection';

describe('door-protection', () => {
    it('does not clamp when the door is closed', () => {
        expect(clampForDoorProtection(100, 30, false)).to.equal(100);
    });

    it('does not clamp when the current position is unknown', () => {
        expect(clampForDoorProtection(100, undefined, true)).to.equal(100);
    });

    it('clamps a further-closing target to the current position while the door is open', () => {
        expect(clampForDoorProtection(100, 30, true)).to.equal(30);
    });

    it('does not clamp an opening target while the door is open', () => {
        expect(clampForDoorProtection(0, 30, true)).to.equal(0);
    });

    it('does not clamp when the target does not close further than the current position', () => {
        expect(clampForDoorProtection(30, 30, true)).to.equal(30);
    });
});
