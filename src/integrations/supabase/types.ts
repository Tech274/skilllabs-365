export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      lab_assignments: {
        Row: {
          assigned_at: string
          assigned_by: string | null
          id: string
          instructor_id: string
          lab_template_id: string
        }
        Insert: {
          assigned_at?: string
          assigned_by?: string | null
          id?: string
          instructor_id: string
          lab_template_id: string
        }
        Update: {
          assigned_at?: string
          assigned_by?: string | null
          id?: string
          instructor_id?: string
          lab_template_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lab_assignments_lab_template_id_fkey"
            columns: ["lab_template_id"]
            isOneToOne: false
            referencedRelation: "lab_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      lab_templates: {
        Row: {
          clipboard_enabled: boolean
          created_at: string
          created_by: string | null
          description: string | null
          duration: number
          file_transfer_enabled: boolean
          id: string
          idle_timeout: number
          name: string
          os_image: string
          protocol: string
          region: string
          status: string
          updated_at: string
          vm_size: string
        }
        Insert: {
          clipboard_enabled?: boolean
          created_at?: string
          created_by?: string | null
          description?: string | null
          duration?: number
          file_transfer_enabled?: boolean
          id?: string
          idle_timeout?: number
          name: string
          os_image?: string
          protocol: string
          region?: string
          status?: string
          updated_at?: string
          vm_size?: string
        }
        Update: {
          clipboard_enabled?: boolean
          created_at?: string
          created_by?: string | null
          description?: string | null
          duration?: number
          file_transfer_enabled?: boolean
          id?: string
          idle_timeout?: number
          name?: string
          os_image?: string
          protocol?: string
          region?: string
          status?: string
          updated_at?: string
          vm_size?: string
        }
        Relationships: []
      }
      platform_settings: {
        Row: {
          id: string
          key: string
          updated_at: string
          updated_by: string | null
          value: Json
        }
        Insert: {
          id?: string
          key: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Update: {
          id?: string
          key?: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string
          email: string | null
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string
          email?: string | null
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string
          email?: string | null
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      sessions: {
        Row: {
          connection_quality: string
          disconnects: number
          ended_at: string | null
          id: string
          idle_minutes: number
          lab_template_id: string | null
          region: string
          started_at: string
          status: string
          user_id: string | null
          vm_id: string | null
        }
        Insert: {
          connection_quality?: string
          disconnects?: number
          ended_at?: string | null
          id?: string
          idle_minutes?: number
          lab_template_id?: string | null
          region?: string
          started_at?: string
          status?: string
          user_id?: string | null
          vm_id?: string | null
        }
        Update: {
          connection_quality?: string
          disconnects?: number
          ended_at?: string | null
          id?: string
          idle_minutes?: number
          lab_template_id?: string | null
          region?: string
          started_at?: string
          status?: string
          user_id?: string | null
          vm_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sessions_lab_template_id_fkey"
            columns: ["lab_template_id"]
            isOneToOne: false
            referencedRelation: "lab_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sessions_vm_id_fkey"
            columns: ["vm_id"]
            isOneToOne: false
            referencedRelation: "virtual_machines"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      virtual_machines: {
        Row: {
          azure_vm_id: string | null
          created_at: string
          expires_at: string | null
          id: string
          idle_minutes: number
          lab_template_id: string | null
          private_ip: string | null
          region: string
          status: string
          updated_at: string
          user_id: string | null
          vm_size: string
        }
        Insert: {
          azure_vm_id?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          idle_minutes?: number
          lab_template_id?: string | null
          private_ip?: string | null
          region?: string
          status?: string
          updated_at?: string
          user_id?: string | null
          vm_size?: string
        }
        Update: {
          azure_vm_id?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          idle_minutes?: number
          lab_template_id?: string | null
          private_ip?: string | null
          region?: string
          status?: string
          updated_at?: string
          user_id?: string | null
          vm_size?: string
        }
        Relationships: [
          {
            foreignKeyName: "virtual_machines_lab_template_id_fkey"
            columns: ["lab_template_id"]
            isOneToOne: false
            referencedRelation: "lab_templates"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "instructor" | "student"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "instructor", "student"],
    },
  },
} as const
