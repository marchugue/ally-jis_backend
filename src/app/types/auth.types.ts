export interface AuthUser {
  id: string;
  email: string;
  user_metadata?: Record<string, unknown>;
  app_metadata?: Record<string, unknown>;
  aud?: string;
  created_at?: string;
}

export interface AuthSession {
  user: AuthUser;
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
}

export interface ProfileRow {
  id: string;
  email?: string;
  full_name?: string | null;
  username?: string | null;
  avatar_url?: string | null;
  bio?: string | null;
  department?: string | null;
  course?: string | null;
  year_level?: string | null;
  interests?: string[];
  organizations?: string[];
  created_at?: string;
  // Verification fields (exposed in user_metadata so the frontend can gate routing)
  email_type?: 'chmsu' | 'external' | null;
  chmsu_auto_verified?: boolean | null;
  pending_student_verification?: boolean | null;
  student_verification_status?: 'pending' | 'approved' | 'rejected' | null;
  admin_verified?: boolean | null;
}

export interface RegisterPayload {
  email: string;
  password: string;
  username: string;
  bio?: string | null;
  department?: string | null;
  course?: string | null;
  year_level?: string | null;
  interests: string[];
  organizations: string[];
  avatar_url?: string | null;
  zodiac_sign?: string | null;
  personality_type?: string | null;
  music_taste?: string[];
  movie_interests?: string[];
  age_range?: string | null;
  match_gender_preference?: string | null;
  // New email type system
  email_type?: 'chmsu' | 'external'; // 'chmsu' = @chmsu.edu.ph, 'external' = any other
  student_id_url?: string | null;    // R2 URL of uploaded student ID front (external path only)
  student_id_back_url?: string | null; // R2 URL of uploaded student ID back (optional)
}

export interface LoginPayload {
  email: string;
  password: string;
}

export interface EmailStatus {
  email: string;
  isEmailVerified: boolean;
  emailConfirmedAt: string | undefined;
}

export interface OtpStatus {
  exists: boolean;
  verified: boolean;
  resendCount: number;
  resendLimit: number;
  expiresAt: string | null;
  /** Remaining resend attempts before the limit is hit */
  resendAttemptsLeft: number;
  /** Number of failed verification attempts (for brute-force feedback) */
  verifyAttempts: number;
  /** True if OTP has expired (expiresAt < now) */
  isExpired: boolean;
  /** Resend cooldown seconds remaining (0 = can resend now) */
  resendCooldownSeconds: number;
}

export interface RegisterResponse {
  userId: string;
  email: string;
  accessToken: string;
  /** True when the response resumes an existing pending verification instead of creating a new account */
  resumePending?: boolean;
  /** OTP expiry ISO timestamp — forwarded to the client so it can start the countdown immediately */
  otpExpiresAt?: string | null;
  /** Resend cooldown seconds remaining (forwarded so client can render the button state correctly) */
  resendCooldownSeconds?: number;
}

// Custom error type used across services/models so the error middleware
// can read `.status` and respond with the right HTTP code.
export class HttpError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
    this.name = 'HttpError';
  }
}