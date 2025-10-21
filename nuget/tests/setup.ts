/**
 * Jest setup file for global test configuration
 */

// Increase timeout for integration tests
jest.setTimeout(30000);

// Mock console methods for cleaner test output
const originalConsole = global.console;

beforeAll(() => {
    global.console = {
        ...originalConsole,
        // Suppress console.log in tests unless explicitly needed
        log: jest.fn(),
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
    };
});

afterAll(() => {
    global.console = originalConsole;
});

// Global test utilities - declare as module to fix TypeScript error
export { };

import { Resource, XRegistryEntity } from '../src/types/xregistry';

declare global {
    namespace jest {
        interface Matchers<R> {
            toBeValidXRegistryEntity(): R;
            toBeValidXRegistryResource(): R;
        }
    }
}

expect.extend({
    toBeValidXRegistryEntity(received: XRegistryEntity) {
        const pass = (
            typeof received === 'object' &&
            received !== null &&
            typeof received.xid === 'string' &&
            received.xid.startsWith('/') &&
            typeof received.self === 'string' &&
            /^https?:\/\/.+$/.test(received.self) &&
            typeof received.epoch === 'number' &&
            received.epoch >= 0 &&
            typeof received.createdat === 'string' &&
            !isNaN(Date.parse(received.createdat)) &&
            typeof received.modifiedat === 'string' &&
            !isNaN(Date.parse(received.modifiedat))
        );

        if (pass) {
            return {
                message: () => `expected ${JSON.stringify(received)} not to be a valid xRegistry entity`,
                pass: true,
            };
        } else {
            return {
                message: () => `expected ${JSON.stringify(received)} to be a valid xRegistry entity`,
                pass: false,
            };
        }
    },

    toBeValidXRegistryResource(received: Resource) {
        const isValidEntity = (
            typeof received === 'object' &&
            received !== null &&
            typeof received.xid === 'string' &&
            received.xid.startsWith('/') &&
            typeof received.self === 'string' &&
            /^https?:\/\/.+$/.test(received.self) &&
            typeof received.epoch === 'number' &&
            received.epoch >= 0 &&
            typeof received.createdat === 'string' &&
            !isNaN(Date.parse(received.createdat)) &&
            typeof received.modifiedat === 'string' &&
            !isNaN(Date.parse(received.modifiedat))
        );

        const isValidResource = (
            isValidEntity &&
            typeof received.packageid === 'string' &&
            received.packageid.length > 0
        );

        if (isValidResource) {
            return {
                message: () => `expected ${JSON.stringify(received)} not to be a valid xRegistry resource`,
                pass: true,
            };
        } else {
            return {
                message: () => `expected ${JSON.stringify(received)} to be a valid xRegistry resource`,
                pass: false,
            };
        }
    },
}); 