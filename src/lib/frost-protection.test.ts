import { expect } from 'chai';
import { evaluateFrostProtection } from './frost-protection';

describe('frost-protection', () => {
    it('is inactive when temperature is above the threshold', () => {
        expect(evaluateFrostProtection({ outdoorTemp: 5, humidity: 95, rain: false, threshold: 2 })).to.equal(false);
    });

    it('is inactive when temperature is unavailable', () => {
        expect(evaluateFrostProtection({ outdoorTemp: undefined, humidity: 95, rain: true, threshold: 2 })).to.equal(
            false,
        );
    });

    it('is inactive when cold but dry', () => {
        expect(evaluateFrostProtection({ outdoorTemp: 0, humidity: 40, rain: false, threshold: 2 })).to.equal(false);
    });

    it('is active when cold and raining', () => {
        expect(evaluateFrostProtection({ outdoorTemp: 0, humidity: 40, rain: true, threshold: 2 })).to.equal(true);
    });

    it('is active when cold and very humid, even without active rain', () => {
        expect(evaluateFrostProtection({ outdoorTemp: 1, humidity: 85, rain: false, threshold: 2 })).to.equal(true);
    });
});
