import { expect } from 'chai';
import { protectedPosition, safePosition } from './covering-types';
import type { CoveringType } from './types';

const ALL_COVERING_TYPES: CoveringType[] = ['rolladen', 'raffstore', 'markise', 'lamellen'];

describe('covering-types', () => {
    describe('safePosition (plan section 7a)', () => {
        for (const coveringType of ALL_COVERING_TYPES) {
            it(`resolves to 0 (retracted/raised) for "${coveringType}"`, () => {
                expect(safePosition(coveringType)).to.equal(0);
            });
        }
    });

    describe('protectedPosition (plan section 7)', () => {
        it('resolves to 100 (close further) for "rolladen"', () => {
            expect(protectedPosition('rolladen')).to.equal(100);
        });

        it('resolves to 100 (close further) for "raffstore"', () => {
            expect(protectedPosition('raffstore')).to.equal(100);
        });

        it('resolves to 100 (close further) for "lamellen"', () => {
            expect(protectedPosition('lamellen')).to.equal(100);
        });

        it('resolves to 0 (retract) for "markise", not 100', () => {
            // An extended awning is itself what gets wet in the rain - extending it further
            // (the rolladen default) would be exactly backwards.
            expect(protectedPosition('markise')).to.equal(0);
        });
    });
});
