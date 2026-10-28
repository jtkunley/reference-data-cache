import {
    CacheDomainAlreadyRegisteredError,
    CacheDomainNotRegisteredError,
} from '../errors.js';

describe('registration error types', () => {
    it('CacheDomainAlreadyRegisteredError exposes its name, domain, and a descriptive message', () => {
        const err = new CacheDomainAlreadyRegisteredError('beta');
        expect(err.name).toBe('CacheDomainAlreadyRegisteredError');
        expect(err.domainName).toBe('beta');
        expect(err.message).toBe('Cache domain "beta" is already registered');
    });

    it('CacheDomainNotRegisteredError exposes its name, domain, and a descriptive message', () => {
        const err = new CacheDomainNotRegisteredError('alpha');
        expect(err.name).toBe('CacheDomainNotRegisteredError');
        expect(err.domainName).toBe('alpha');
        expect(err.message).toBe('Cache domain "alpha" is not registered');
    });

    it('names the raising component in the message when a context is given', () => {
        expect(
            new CacheDomainNotRegisteredError('gamma', 'CacheReader').message,
        ).toBe('CacheReader domain "gamma" is not registered');
        expect(
            new CacheDomainAlreadyRegisteredError('gamma', 'CacheOwner')
                .message,
        ).toBe('CacheOwner domain "gamma" is already registered');
    });
});
