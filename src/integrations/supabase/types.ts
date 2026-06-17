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
      access_rules: {
        Row: {
          active: boolean
          asset_id: string
          asset_type: string
          created_at: string
          created_by: string | null
          id: string
          required_plan: string | null
          required_role: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          asset_id: string
          asset_type: string
          created_at?: string
          created_by?: string | null
          id?: string
          required_plan?: string | null
          required_role?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          asset_id?: string
          asset_type?: string
          created_at?: string
          created_by?: string | null
          id?: string
          required_plan?: string | null
          required_role?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      activity_logs: {
        Row: {
          action: string
          actor_id: string
          created_at: string
          details: Json
          id: string
          target_user_id: string
        }
        Insert: {
          action: string
          actor_id: string
          created_at?: string
          details?: Json
          id?: string
          target_user_id: string
        }
        Update: {
          action?: string
          actor_id?: string
          created_at?: string
          details?: Json
          id?: string
          target_user_id?: string
        }
        Relationships: []
      }
      certifications_catalog: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          name: string
          org_id: string | null
          published: boolean
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name: string
          org_id?: string | null
          published?: boolean
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name?: string
          org_id?: string | null
          published?: boolean
          slug?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "certifications_catalog_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_reports: {
        Row: {
          created_at: string
          data: Json
          id: string
          report_date: string
        }
        Insert: {
          created_at?: string
          data?: Json
          id?: string
          report_date?: string
        }
        Update: {
          created_at?: string
          data?: Json
          id?: string
          report_date?: string
        }
        Relationships: []
      }
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
      manual_access_grants: {
        Row: {
          active: boolean
          asset_id: string | null
          asset_type: string | null
          certification_slug: string | null
          created_at: string
          ends_at: string | null
          granted_by: string | null
          id: string
          note: string | null
          plan_key: string | null
          starts_at: string
          updated_at: string
          user_id: string
        }
        Insert: {
          active?: boolean
          asset_id?: string | null
          asset_type?: string | null
          certification_slug?: string | null
          created_at?: string
          ends_at?: string | null
          granted_by?: string | null
          id?: string
          note?: string | null
          plan_key?: string | null
          starts_at?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          active?: boolean
          asset_id?: string | null
          asset_type?: string | null
          certification_slug?: string | null
          created_at?: string
          ends_at?: string | null
          granted_by?: string | null
          id?: string
          note?: string | null
          plan_key?: string | null
          starts_at?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      mock_exams: {
        Row: {
          cert_slug: string
          created_at: string
          created_by: string | null
          duration_min: number
          id: string
          org_id: string | null
          published: boolean
          title: string
          updated_at: string
        }
        Insert: {
          cert_slug: string
          created_at?: string
          created_by?: string | null
          duration_min?: number
          id?: string
          org_id?: string | null
          published?: boolean
          title: string
          updated_at?: string
        }
        Update: {
          cert_slug?: string
          created_at?: string
          created_by?: string | null
          duration_min?: number
          id?: string
          org_id?: string | null
          published?: boolean
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "mock_exams_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          created_at: string
          id: string
          message: string
          read: boolean
          title: string
          type: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          message: string
          read?: boolean
          title: string
          type?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          message?: string
          read?: boolean
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: []
      }
      org_members: {
        Row: {
          created_at: string
          id: string
          org_id: string
          org_role: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          org_id: string
          org_role: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          org_id?: string
          org_role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "org_members_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          name: string
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      pending_invitations: {
        Row: {
          accepted: boolean
          created_at: string
          email: string
          id: string
          invited_by: string
          role: Database["public"]["Enums"]["app_role"]
        }
        Insert: {
          accepted?: boolean
          created_at?: string
          email: string
          id?: string
          invited_by: string
          role?: Database["public"]["Enums"]["app_role"]
        }
        Update: {
          accepted?: boolean
          created_at?: string
          email?: string
          id?: string
          invited_by?: string
          role?: Database["public"]["Enums"]["app_role"]
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
      question_bank: {
        Row: {
          answer: string
          choices: Json
          created_at: string
          created_by: string | null
          explanation: string | null
          id: string
          mock_exam_id: string
          org_id: string | null
          prompt: string
          updated_at: string
        }
        Insert: {
          answer: string
          choices?: Json
          created_at?: string
          created_by?: string | null
          explanation?: string | null
          id?: string
          mock_exam_id: string
          org_id?: string | null
          prompt: string
          updated_at?: string
        }
        Update: {
          answer?: string
          choices?: Json
          created_at?: string
          created_by?: string | null
          explanation?: string | null
          id?: string
          mock_exam_id?: string
          org_id?: string | null
          prompt?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "question_bank_mock_exam_id_fkey"
            columns: ["mock_exam_id"]
            isOneToOne: false
            referencedRelation: "mock_exams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "question_bank_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      resources: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          downloads_enabled: boolean
          external_url: string | null
          id: string
          kind: string
          org_id: string | null
          published: boolean
          required_plan: string | null
          required_role: string | null
          storage_path: string | null
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          downloads_enabled?: boolean
          external_url?: string | null
          id?: string
          kind: string
          org_id?: string | null
          published?: boolean
          required_plan?: string | null
          required_role?: string | null
          storage_path?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          downloads_enabled?: boolean
          external_url?: string | null
          id?: string
          kind?: string
          org_id?: string | null
          published?: boolean
          required_plan?: string | null
          required_role?: string | null
          storage_path?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "resources_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      session_events: {
        Row: {
          created_at: string
          event_data: Json
          event_type: string
          id: string
          session_id: string
        }
        Insert: {
          created_at?: string
          event_data?: Json
          event_type: string
          id?: string
          session_id: string
        }
        Update: {
          created_at?: string
          event_data?: Json
          event_type?: string
          id?: string
          session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "session_events_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      sessions: {
        Row: {
          connection_quality: string
          disconnects: number
          ended_at: string | null
          guac_connection_id: string | null
          guac_username: string | null
          id: string
          idle_minutes: number
          lab_template_id: string | null
          last_activity_at: string | null
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
          guac_connection_id?: string | null
          guac_username?: string | null
          id?: string
          idle_minutes?: number
          lab_template_id?: string | null
          last_activity_at?: string | null
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
          guac_connection_id?: string | null
          guac_username?: string | null
          id?: string
          idle_minutes?: number
          lab_template_id?: string | null
          last_activity_at?: string | null
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
      subscriptions: {
        Row: {
          created_at: string
          current_period_end: string | null
          id: string
          plan_key: string
          provider: string | null
          provider_subscription_id: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          current_period_end?: string | null
          id?: string
          plan_key: string
          provider?: string | null
          provider_subscription_id?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          current_period_end?: string | null
          id?: string
          plan_key?: string
          provider?: string | null
          provider_subscription_id?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
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
          status: Database["public"]["Enums"]["vm_status"]
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
          status?: Database["public"]["Enums"]["vm_status"]
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
          status?: Database["public"]["Enums"]["vm_status"]
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
      has_asset_access: {
        Args: { _asset_id: string; _asset_type: string; _user_id: string }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_org_member: {
        Args: { _org_id: string; _user_id: string }
        Returns: boolean
      }
      is_org_role: {
        Args: { _org_id: string; _role: string; _user_id: string }
        Returns: boolean
      }
      is_platform_admin: { Args: { _user_id: string }; Returns: boolean }
    }
    Enums: {
      app_role:
        | "admin"
        | "instructor"
        | "student"
        | "super_admin"
        | "content_admin"
        | "org_exec"
        | "org_manager"
      vm_status:
        | "provisioning"
        | "starting"
        | "running"
        | "idle"
        | "expired"
        | "stopped"
        | "deallocated"
        | "terminated"
        | "failed"
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
      app_role: [
        "admin",
        "instructor",
        "student",
        "super_admin",
        "content_admin",
        "org_exec",
        "org_manager",
      ],
      vm_status: [
        "provisioning",
        "starting",
        "running",
        "idle",
        "expired",
        "stopped",
        "deallocated",
        "terminated",
        "failed",
      ],
    },
  },
} as const
