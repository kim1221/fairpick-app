// Minimal fallback for the culture card migration.
// Replace this file with `supabase gen types --schema public` output when
// the Supabase project is reachable from the workspace.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      user_visit_log: {
        Row: {
          id: string;
          user_id: string;
          event_id: string;
          bonus_tickets: number;
          visited_at: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          event_id: string;
          bonus_tickets?: number;
          visited_at?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          event_id?: string;
          bonus_tickets?: number;
          visited_at?: string;
          created_at?: string;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
