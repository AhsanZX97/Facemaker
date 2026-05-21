import { getSupabase } from '@/lib/supabase';

export interface ClaimedIdentity {
  playerId: string;
  displayName: string;
  isNew: boolean;
}

/**
 * Calls the `claim_or_login(name, pin)` RPC.
 * - If the name is free: claims it, hashes the PIN, returns a fresh uuid.
 * - If the name exists and the PIN matches: returns the existing uuid.
 * - If the name exists and the PIN doesn't match: throws.
 *
 * The returned uuid is the player_id used for every subsequent round insert.
 * It's the only credential the client needs to remember after this call.
 */
export async function claimOrLogin(
  name: string,
  pin: string,
): Promise<ClaimedIdentity> {
  const sb = getSupabase();
  if (!sb) {
    throw new Error('Leaderboard backend is not configured');
  }
  const { data, error } = await sb.rpc('claim_or_login', {
    p_name: name,
    p_pin: pin,
  });
  if (error) {
    // Postgres surfaces our custom messages via error.message; the SQLSTATE
    // tells us whether it was an input validation error (22023) or a wrong
    // PIN (28000). The default Supabase wrapper drops the code in non-PG
    // errors, so we lean on substring matching as a fallback.
    if (
      error.code === '28000' ||
      /incorrect pin/i.test(error.message)
    ) {
      throw new Error('Wrong PIN for that name. Try again.');
    }
    throw new Error(error.message || 'Could not sign in');
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.player_id) {
    throw new Error('Empty response from server');
  }
  return {
    playerId: row.player_id,
    displayName: row.display_name,
    isNew: Boolean(row.is_new),
  };
}
