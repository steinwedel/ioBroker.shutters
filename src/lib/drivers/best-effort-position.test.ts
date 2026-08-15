import { expect } from 'chai';
import { BestEffortPositionEstimate } from './best-effort-position';

describe('BestEffortPositionEstimate', () => {
    it('starts out unknown', () => {
        const estimate = new BestEffortPositionEstimate();

        expect(estimate.getValue()).to.be.undefined;
    });

    it('markOpened() sets the estimate to 0', () => {
        const estimate = new BestEffortPositionEstimate();

        estimate.markOpened();

        expect(estimate.getValue()).to.equal(0);
    });

    it('markClosed() sets the estimate to 100', () => {
        const estimate = new BestEffortPositionEstimate();

        estimate.markClosed();

        expect(estimate.getValue()).to.equal(100);
    });

    it('invalidate() discards a previously known estimate', () => {
        const estimate = new BestEffortPositionEstimate();
        estimate.markClosed();

        estimate.invalidate();

        expect(estimate.getValue()).to.be.undefined;
    });

    it('a later markOpened()/markClosed() overrides an earlier value', () => {
        const estimate = new BestEffortPositionEstimate();

        estimate.markClosed();
        estimate.markOpened();

        expect(estimate.getValue()).to.equal(0);
    });
});
