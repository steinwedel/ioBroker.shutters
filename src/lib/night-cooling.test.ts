import { expect } from 'chai';
import { evaluateNightCooling } from './night-cooling';

describe('night-cooling', () => {
    describe('evaluateNightCooling', () => {
        it('is active when indoor is hot, outdoor is meaningfully cooler, and it is summer', () => {
            expect(
                evaluateNightCooling({
                    indoorTemp: 25,
                    outdoorTemp: 18,
                    indoorMinTemp: 24,
                    minDelta: 3,
                    isSummer: true,
                }),
            ).to.be.true;
        });

        it('is inactive outside summer, even if the temperatures would otherwise qualify', () => {
            expect(
                evaluateNightCooling({
                    indoorTemp: 25,
                    outdoorTemp: 18,
                    indoorMinTemp: 24,
                    minDelta: 3,
                    isSummer: false,
                }),
            ).to.be.false;
        });

        it('is inactive when indoor temperature is below the minimum', () => {
            expect(
                evaluateNightCooling({
                    indoorTemp: 23,
                    outdoorTemp: 15,
                    indoorMinTemp: 24,
                    minDelta: 3,
                    isSummer: true,
                }),
            ).to.be.false;
        });

        it('is inactive when the indoor/outdoor delta is below the minimum, even if indoor alone qualifies', () => {
            expect(
                evaluateNightCooling({
                    indoorTemp: 25,
                    outdoorTemp: 23,
                    indoorMinTemp: 24,
                    minDelta: 3,
                    isSummer: true,
                }),
            ).to.be.false;
        });

        it('is active exactly at the indoor-minimum and delta-minimum boundaries', () => {
            expect(
                evaluateNightCooling({
                    indoorTemp: 24,
                    outdoorTemp: 21,
                    indoorMinTemp: 24,
                    minDelta: 3,
                    isSummer: true,
                }),
            ).to.be.true;
        });

        it('is inactive when indoor temperature is unavailable', () => {
            expect(
                evaluateNightCooling({
                    indoorTemp: undefined,
                    outdoorTemp: 15,
                    indoorMinTemp: 24,
                    minDelta: 3,
                    isSummer: true,
                }),
            ).to.be.false;
        });

        it('is inactive when outdoor temperature is unavailable', () => {
            expect(
                evaluateNightCooling({
                    indoorTemp: 26,
                    outdoorTemp: undefined,
                    indoorMinTemp: 24,
                    minDelta: 3,
                    isSummer: true,
                }),
            ).to.be.false;
        });
    });
});
