// Seatbelt's `localhost` includes every address owned by this host. Therefore
// startup grants inbound sockets only; outbound remains denied, including loopback.
// A separate observer fetches DSH's explicitly bound 127.0.0.1 listener.
export function sandboxProfile(mode) {
  return `(version 1)\n(allow default)\n(deny network*)\n${mode === 'loopback' ? '(allow network-bind (local ip "localhost:*"))\n(allow network-inbound (local ip "localhost:*"))' : ''}\n`
}
