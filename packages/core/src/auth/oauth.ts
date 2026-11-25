/**
 * OAuth client secrets belong to the private deployment, not this repository.
 * A deployment may pass an https authorization URL. This module rejects URLs that embed a client secret.
 */
export type OAuthProviderId = "google" | "github" | "custom";

export class OAuthNotConfiguredError extends Error {
  constructor(provider: OAuthProviderId) {
    super(`OAuth provider "${provider}" has no client configuration in this build.`);
    this.name = "OAuthNotConfiguredError";
  }
}

export function startOAuth(provider: OAuthProviderId, client: { authorizationUrl?: string } | undefined): string {
  if (!client?.authorizationUrl) throw new OAuthNotConfiguredError(provider);
  const url = new URL(client.authorizationUrl);
  if (url.protocol !== "https:") throw new Error("OAuth authorization URL must use https.");
  if (url.username || url.password || url.searchParams.has("client_secret")) {
    throw new Error("OAuth configuration must not embed a client secret.");
  }
  return url.toString();
}
