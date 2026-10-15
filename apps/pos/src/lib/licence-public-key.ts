/**
 * The builder's Ed25519 public key (SPKI PEM), written here by the build script for each client
 * build. Only the public key is ever embedded; the signing key never leaves the builder (BR-31).
 * Empty in the template, so a production server without an injected key refuses to serve.
 */
export const LICENCE_PUBLIC_KEY_PEM = ''
