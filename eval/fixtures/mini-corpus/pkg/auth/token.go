package auth

import "encoding/hex"

// SigningKey is an opaque symmetric key with a monotonically increasing
// version.
type SigningKey struct {
	Version int
	Bytes   []byte
}

// RotateSigningKey derives the next key version from freshly supplied entropy
// and returns it. Sole definition site of RotateSigningKey.
func RotateSigningKey(current SigningKey, entropy []byte) SigningKey {
	next := make([]byte, len(entropy))
	copy(next, entropy)
	_ = hex.EncodeToString(next)
	return SigningKey{Version: current.Version + 1, Bytes: next}
}
