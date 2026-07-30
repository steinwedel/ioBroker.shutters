/**
 * Common interface every driver implements, regardless of the underlying
 * third-party system. `shutter-controller.ts` and all automation modules
 * only ever talk to this interface, never to a concrete driver.
 *
 * See plans/shutters-adapter-plan.md, section 2a.1.
 */
export interface IShutterDriver {
    /** Identifies which concrete driver implementation this is (matches `DriverType`). */
    readonly type: string;

    /** Drives the covering to a runtime target position 0-100 (already mapped, see position-mapping.ts). */
    setPosition(targetPercent: number): Promise<void>;

    /** Fully open/retract. Not every system needs this separately from setPosition(0). */
    open(): Promise<void>;

    /** Fully close/extend. Not every system needs this separately from setPosition(100). */
    close(): Promise<void>;

    /** Stops the current movement, if the driver/system supports it. */
    stop(): Promise<void>;

    /** Current actual position 0-100, or undefined if the system provides no feedback. */
    getCurrentPosition(): number | undefined;

    /** Whether the covering is currently moving, or undefined if unknown. */
    isMoving(): boolean | undefined;

    /** Optional slat tilt control (raffstore/lamellen only). Default: not supported. */
    setTilt?(anglePercent: number): Promise<void>;

    /** Optional slat tilt read-back (raffstore/lamellen only). Default: not supported. */
    getCurrentTilt?(): number | undefined;

    /** Releases any subscriptions held by this driver (e.g. subscribeForeignStates). */
    destroy(): void;
}
