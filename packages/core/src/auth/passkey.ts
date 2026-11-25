export type PasskeyCreationOptions = {
  challenge: Uint8Array;
  rp: { name: "Vaulthropic"; id: string };
  user: { id: Uint8Array; name: string; displayName: string };
  pubKeyCredParams: Array<{ type: "public-key"; alg: number }>;
  authenticatorSelection: {
    residentKey: "preferred";
    userVerification: "required";
  };
  timeout: number;
  attestation: "none";
};

export function passkeyCreationOptions(input: {
  challenge: Uint8Array;
  userId: Uint8Array;
  userName: string;
  rpId: string;
}): PasskeyCreationOptions {
  if (input.challenge.byteLength < 16) throw new Error("Passkey challenge is too short.");
  if (input.userId.byteLength < 8) throw new Error("Passkey user id is too short.");
  if (!/^[a-zA-Z0-9._@+-]{1,128}$/.test(input.userName)) throw new Error("Passkey user name is invalid.");
  if (!/^[a-z0-9.-]+$/.test(input.rpId)) throw new Error("Passkey relying party id is invalid.");
  return {
    challenge: input.challenge,
    rp: { name: "Vaulthropic", id: input.rpId },
    user: { id: input.userId, name: input.userName, displayName: input.userName },
    pubKeyCredParams: [
      { type: "public-key", alg: -7 },
      { type: "public-key", alg: -257 },
    ],
    authenticatorSelection: { residentKey: "preferred", userVerification: "required" },
    timeout: 60_000,
    attestation: "none",
  };
}

export function passkeyRequestOptions(input: { challenge: Uint8Array; rpId: string; credentialId?: Uint8Array }) {
  if (input.challenge.byteLength < 16) throw new Error("Passkey challenge is too short.");
  return {
    challenge: input.challenge,
    rpId: input.rpId,
    userVerification: "required" as const,
    timeout: 60_000,
    ...(input.credentialId
      ? { allowCredentials: [{ type: "public-key" as const, id: input.credentialId }] }
      : {}),
  };
}
