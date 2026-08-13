import { expect } from 'chai';
import { nextAvailableCoveringId } from './id-generator';

describe('nextAvailableCoveringId', () => {
    it('returns "shutter1" when no IDs are used yet', () => {
        expect(nextAvailableCoveringId([])).to.equal('shutter1');
    });

    it('skips IDs that are already used', () => {
        expect(nextAvailableCoveringId(['shutter1', 'shutter2'])).to.equal('shutter3');
    });

    it('fills a gap left by a removed covering rather than always appending', () => {
        // "shutter2" was removed; the next call still reuses it, since it is unused again.
        expect(nextAvailableCoveringId(['shutter1', 'shutter3'])).to.equal('shutter2');
    });

    it('ignores unrelated, non-matching existing IDs (e.g. legacy Homematic-derived ones)', () => {
        expect(nextAvailableCoveringId(['hm-rpc_2_00111BE99280E9_4_LEVEL', 'shutter1'])).to.equal('shutter2');
    });

    it('supports a custom prefix', () => {
        expect(nextAvailableCoveringId(['covering1'], 'covering')).to.equal('covering2');
    });

    it('accepts any Iterable<string>, not just arrays', () => {
        const existingIds = new Set(['shutter1']);
        expect(nextAvailableCoveringId(existingIds)).to.equal('shutter2');
    });
});
