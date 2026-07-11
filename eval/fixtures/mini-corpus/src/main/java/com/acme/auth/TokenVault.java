package com.acme.auth;

import java.util.Optional;

/**
 * A sealable store of session tokens. Reads fail while the vault is sealed.
 */
public final class TokenVault {

    private boolean sealed = true;

    public void unsealVault() {
        this.sealed = false;
    }

    /**
     * Fetch a token by handle. Throws when the vault has not been unsealed.
     */
    public Optional<String> read(String handle) {
        if (sealed) {
            throw new IllegalStateException("session token vault is sealed");
        }
        return Optional.ofNullable(handle).map(h -> "tok_" + h);
    }
}
