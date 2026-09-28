// Types for addressLookup.js (see the comments there).

export declare const GEOCODER_URL: string;
export declare const MAX_LISTED: number;

export interface AddressMatch {
  address: string;
  street: string;
  zip: string;
  lat: number;
  lon: number;
  countyFips: string;
  countyName: string;
}

export interface ParcelsLink {
  match: AddressMatch;
  county: string;
  url: string;
}

export interface LookupResult {
  status: "found" | "none" | "not-ohio" | "no-app" | "error";
  links: ParcelsLink[];
  matches: AddressMatch[];
  error?: string;
}

export type ParcelsApps = Record<string, { county: string; url: string }>;

export declare function geocoderUrl(address: string, jsonpCallback?: string): string;
export declare function ohioRetryAddress(address: string): string | null;
export declare function parseMatches(json: unknown): AddressMatch[];
export declare function parcelsLink(match: AddressMatch, apps?: ParcelsApps): ParcelsLink | null;
export declare function resolve(json: unknown, apps?: ParcelsApps): LookupResult;
export declare function lookupWithFetch(address: string, fetchImpl?: typeof fetch): Promise<LookupResult>;
export declare function lookupWithJsonp(
  address: string,
  opts?: { doc?: Document; win?: unknown; timeoutMs?: number },
): Promise<LookupResult>;
