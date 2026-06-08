// Temporary permissive Supabase type surface.
// Replace with generated Supabase types when CLI is available.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: Record<string, {
      Row: Record<string, any>;
      Insert: Record<string, any>;
      Update: Record<string, any>;
      Relationships: any[];
    }>;
    Views: Record<string, {
      Row: Record<string, any>;
      Relationships: any[];
    }>;
    Functions: Record<string, any>;
    Enums: Record<string, string>;
    CompositeTypes: Record<string, any>;
  };
};

export const Constants = {
  public: {
    Enums: {},
  },
} as const;
