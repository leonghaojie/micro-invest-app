/**
 * ProfileService — FR03. Budget band (B1–B4) derivation from raw monthly
 * budget input happens server-side here (Design Model §4.2, user_profiles).
 * Implementation lands in Phase 3.
 */
class ProfileService {
  async getProfile(_userId: string): Promise<{ implemented: false }> {
    return { implemented: false };
  }

  async upsertProfile(_userId: string, _input: unknown): Promise<{ implemented: false }> {
    return { implemented: false };
  }
}

export const profileService = new ProfileService();
