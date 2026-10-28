import {
    CacheDomainAlreadyRegisteredError,
    CacheDomainNotRegisteredError,
} from '../cache-tier-errors.js';

describe('registration error types', () => {
    it('CacheDomainAlreadyRegisteredError exposes its name and a descriptive message', () => {
        const err = new CacheDomainAlreadyRegisteredError('beta');
        expect(err.name).toBe('CacheDomainAlreadyRegisteredError');
        expect(err.message).toBe('Cache domain "beta" is already registered');
    });

    it('CacheDomainNotRegisteredError exposes its name and a descriptive message', () => {
        const err = new CacheDomainNotRegisteredError('alpha');
        expect(err.name).toBe('CacheDomainNotRegisteredError');
        expect(err.message).toBe('Cache domain "alpha" is not registered');
    });
});
