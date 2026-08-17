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
      access_session_events: {
        Row: {
          actor_id: string | null
          at: string
          event_type: string
          id: string
          payload: Json
          session_id: string
        }
        Insert: {
          actor_id?: string | null
          at?: string
          event_type: string
          id?: string
          payload?: Json
          session_id: string
        }
        Update: {
          actor_id?: string | null
          at?: string
          event_type?: string
          id?: string
          payload?: Json
          session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "access_session_events_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "access_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      access_sessions: {
        Row: {
          batch_id: string | null
          created_at: string
          credit_consumed: number
          ended_at: string | null
          error_message: string | null
          expires_at: string
          federated_url: string | null
          id: string
          last_activity_at: string
          parent_session_id: string | null
          provider: Database["public"]["Enums"]["cloud_provider"]
          provider_session_ref: string | null
          refresh_count: number
          region: string | null
          scope: Json
          started_at: string
          status: Database["public"]["Enums"]["access_session_status"]
          template_id: string
          updated_at: string
          user_id: string
          workspace_batch_id: string | null
        }
        Insert: {
          batch_id?: string | null
          created_at?: string
          credit_consumed?: number
          ended_at?: string | null
          error_message?: string | null
          expires_at: string
          federated_url?: string | null
          id?: string
          last_activity_at?: string
          parent_session_id?: string | null
          provider: Database["public"]["Enums"]["cloud_provider"]
          provider_session_ref?: string | null
          refresh_count?: number
          region?: string | null
          scope?: Json
          started_at?: string
          status?: Database["public"]["Enums"]["access_session_status"]
          template_id: string
          updated_at?: string
          user_id: string
          workspace_batch_id?: string | null
        }
        Update: {
          batch_id?: string | null
          created_at?: string
          credit_consumed?: number
          ended_at?: string | null
          error_message?: string | null
          expires_at?: string
          federated_url?: string | null
          id?: string
          last_activity_at?: string
          parent_session_id?: string | null
          provider?: Database["public"]["Enums"]["cloud_provider"]
          provider_session_ref?: string | null
          refresh_count?: number
          region?: string | null
          scope?: Json
          started_at?: string
          status?: Database["public"]["Enums"]["access_session_status"]
          template_id?: string
          updated_at?: string
          user_id?: string
          workspace_batch_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "access_sessions_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "template_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "access_sessions_parent_session_id_fkey"
            columns: ["parent_session_id"]
            isOneToOne: false
            referencedRelation: "access_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "access_sessions_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "access_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "access_sessions_workspace_batch_id_fkey"
            columns: ["workspace_batch_id"]
            isOneToOne: false
            referencedRelation: "template_workspace_batches"
            referencedColumns: ["id"]
          },
        ]
      }
      access_templates: {
        Row: {
          allowed_services: Json
          created_at: string
          created_by: string | null
          credit_limit: number
          description: string | null
          id: string
          name: string
          org_id: string | null
          provider: Database["public"]["Enums"]["cloud_provider"]
          provider_config: Json
          refresh_allowed: boolean
          region: string | null
          self_enroll: boolean
          session_duration_minutes: number
          status: Database["public"]["Enums"]["access_template_status"]
          updated_at: string
          validity_days: number
        }
        Insert: {
          allowed_services?: Json
          created_at?: string
          created_by?: string | null
          credit_limit?: number
          description?: string | null
          id?: string
          name: string
          org_id?: string | null
          provider: Database["public"]["Enums"]["cloud_provider"]
          provider_config?: Json
          refresh_allowed?: boolean
          region?: string | null
          self_enroll?: boolean
          session_duration_minutes?: number
          status?: Database["public"]["Enums"]["access_template_status"]
          updated_at?: string
          validity_days?: number
        }
        Update: {
          allowed_services?: Json
          created_at?: string
          created_by?: string | null
          credit_limit?: number
          description?: string | null
          id?: string
          name?: string
          org_id?: string | null
          provider?: Database["public"]["Enums"]["cloud_provider"]
          provider_config?: Json
          refresh_allowed?: boolean
          region?: string | null
          self_enroll?: boolean
          session_duration_minutes?: number
          status?: Database["public"]["Enums"]["access_template_status"]
          updated_at?: string
          validity_days?: number
        }
        Relationships: [
          {
            foreignKeyName: "access_templates_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
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
      ai_alert_deliveries: {
        Row: {
          alert_status: string
          alert_title: string
          channel: string
          created_at: string
          delivery_status: string
          detail: string | null
          id: string
          latency_ms: number | null
          model: string | null
          recipients: number
        }
        Insert: {
          alert_status: string
          alert_title: string
          channel: string
          created_at?: string
          delivery_status: string
          detail?: string | null
          id?: string
          latency_ms?: number | null
          model?: string | null
          recipients?: number
        }
        Update: {
          alert_status?: string
          alert_title?: string
          channel?: string
          created_at?: string
          delivery_status?: string
          detail?: string | null
          id?: string
          latency_ms?: number | null
          model?: string | null
          recipients?: number
        }
        Relationships: []
      }
      ai_request_logs: {
        Row: {
          attempts: number
          created_at: string
          error_message: string | null
          error_type: string | null
          function_name: string
          http_status: number | null
          id: string
          latency_ms: number | null
          model: string | null
          org_id: string | null
          request_id: string | null
          status: string
          user_id: string | null
        }
        Insert: {
          attempts?: number
          created_at?: string
          error_message?: string | null
          error_type?: string | null
          function_name: string
          http_status?: number | null
          id?: string
          latency_ms?: number | null
          model?: string | null
          org_id?: string | null
          request_id?: string | null
          status: string
          user_id?: string | null
        }
        Update: {
          attempts?: number
          created_at?: string
          error_message?: string | null
          error_type?: string | null
          function_name?: string
          http_status?: number | null
          id?: string
          latency_ms?: number | null
          model?: string | null
          org_id?: string | null
          request_id?: string | null
          status?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_request_logs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_usage_quotas: {
        Row: {
          active: boolean
          created_at: string
          created_by: string | null
          daily_limit: number
          id: string
          note: string | null
          per_minute_limit: number
          scope: string
          scope_id: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          daily_limit?: number
          id?: string
          note?: string | null
          per_minute_limit?: number
          scope: string
          scope_id?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          daily_limit?: number
          id?: string
          note?: string | null
          per_minute_limit?: number
          scope?: string
          scope_id?: string | null
          updated_at?: string
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
      cloud_provider_config: {
        Row: {
          config: Json
          provider: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          config?: Json
          provider: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          config?: Json
          provider?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      cloud_provider_health_checks: {
        Row: {
          check_name: string
          checked_at: string
          detail: string | null
          id: string
          latency_ms: number | null
          provider: string
          region: string | null
          status: string
        }
        Insert: {
          check_name: string
          checked_at?: string
          detail?: string | null
          id?: string
          latency_ms?: number | null
          provider: string
          region?: string | null
          status: string
        }
        Update: {
          check_name?: string
          checked_at?: string
          detail?: string | null
          id?: string
          latency_ms?: number | null
          provider?: string
          region?: string | null
          status?: string
        }
        Relationships: []
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
          azure_object_id: string | null
          created_at: string
          display_name: string
          email: string | null
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_url?: string | null
          azure_object_id?: string | null
          created_at?: string
          display_name?: string
          email?: string | null
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          azure_object_id?: string | null
          created_at?: string
          display_name?: string
          email?: string | null
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      provisioning_events: {
        Row: {
          correlation_id: string
          created_at: string
          detail: Json | null
          duration_ms: number | null
          id: string
          lab_template_id: string | null
          message: string | null
          session_id: string | null
          source: string
          status: string
          step: string
          user_id: string | null
          vm_id: string | null
        }
        Insert: {
          correlation_id: string
          created_at?: string
          detail?: Json | null
          duration_ms?: number | null
          id?: string
          lab_template_id?: string | null
          message?: string | null
          session_id?: string | null
          source: string
          status?: string
          step: string
          user_id?: string | null
          vm_id?: string | null
        }
        Update: {
          correlation_id?: string
          created_at?: string
          detail?: Json | null
          duration_ms?: number | null
          id?: string
          lab_template_id?: string | null
          message?: string | null
          session_id?: string | null
          source?: string
          status?: string
          step?: string
          user_id?: string | null
          vm_id?: string | null
        }
        Relationships: []
      }
      provisioning_idempotency: {
        Row: {
          action: string
          completed_at: string | null
          correlation_id: string | null
          created_at: string
          expires_at: string
          id: string
          idempotency_key: string
          response: Json | null
          status: string
          user_id: string
        }
        Insert: {
          action: string
          completed_at?: string | null
          correlation_id?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          idempotency_key: string
          response?: Json | null
          status?: string
          user_id: string
        }
        Update: {
          action?: string
          completed_at?: string | null
          correlation_id?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          idempotency_key?: string
          response?: Json | null
          status?: string
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
      template_assignments: {
        Row: {
          assignee_id: string | null
          assignee_type: Database["public"]["Enums"]["template_assignee_type"]
          batch_id: string | null
          granted_at: string
          granted_by: string | null
          id: string
          revoked_at: string | null
          template_id: string
          workspace_batch_id: string | null
        }
        Insert: {
          assignee_id?: string | null
          assignee_type: Database["public"]["Enums"]["template_assignee_type"]
          batch_id?: string | null
          granted_at?: string
          granted_by?: string | null
          id?: string
          revoked_at?: string | null
          template_id: string
          workspace_batch_id?: string | null
        }
        Update: {
          assignee_id?: string | null
          assignee_type?: Database["public"]["Enums"]["template_assignee_type"]
          batch_id?: string | null
          granted_at?: string
          granted_by?: string | null
          id?: string
          revoked_at?: string | null
          template_id?: string
          workspace_batch_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "template_assignments_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "template_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "template_assignments_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "access_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "template_assignments_workspace_batch_id_fkey"
            columns: ["workspace_batch_id"]
            isOneToOne: false
            referencedRelation: "template_workspace_batches"
            referencedColumns: ["id"]
          },
        ]
      }
      template_batches: {
        Row: {
          created_at: string
          created_by: string | null
          credit_allocation: number
          end_date: string | null
          id: string
          lab_count: number
          name: string
          org_id: string | null
          published: boolean
          session_duration_override: number | null
          start_date: string | null
          template_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          credit_allocation?: number
          end_date?: string | null
          id?: string
          lab_count?: number
          name: string
          org_id?: string | null
          published?: boolean
          session_duration_override?: number | null
          start_date?: string | null
          template_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          credit_allocation?: number
          end_date?: string | null
          id?: string
          lab_count?: number
          name?: string
          org_id?: string | null
          published?: boolean
          session_duration_override?: number | null
          start_date?: string | null
          template_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "template_batches_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "template_batches_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "access_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      template_workspace_batches: {
        Row: {
          created_at: string
          created_by: string | null
          end_date: string | null
          id: string
          lab_count: number
          name: string
          org_id: string | null
          published: boolean
          session_duration_override: number | null
          shared_credit_pool: number
          start_date: string | null
          template_id: string
          updated_at: string
          workspace_group_id: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          end_date?: string | null
          id?: string
          lab_count?: number
          name: string
          org_id?: string | null
          published?: boolean
          session_duration_override?: number | null
          shared_credit_pool?: number
          start_date?: string | null
          template_id: string
          updated_at?: string
          workspace_group_id?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          end_date?: string | null
          id?: string
          lab_count?: number
          name?: string
          org_id?: string | null
          published?: boolean
          session_duration_override?: number | null
          shared_credit_pool?: number
          start_date?: string | null
          template_id?: string
          updated_at?: string
          workspace_group_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "template_workspace_batches_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "template_workspace_batches_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "access_templates"
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
      user_can_access_template: {
        Args: { _template_id: string; _user_id: string }
        Returns: boolean
      }
    }
    Enums: {
      access_session_status:
        | "created"
        | "active"
        | "expired"
        | "refreshed"
        | "revoked"
        | "failed"
        | "completed"
      access_template_status: "draft" | "published" | "archived"
      app_role:
        | "admin"
        | "instructor"
        | "student"
        | "super_admin"
        | "content_admin"
        | "org_exec"
        | "org_manager"
      cloud_provider: "azure" | "aws" | "gcp"
      template_assignee_type: "user" | "org" | "group" | "self_enroll"
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
      access_session_status: [
        "created",
        "active",
        "expired",
        "refreshed",
        "revoked",
        "failed",
        "completed",
      ],
      access_template_status: ["draft", "published", "archived"],
      app_role: [
        "admin",
        "instructor",
        "student",
        "super_admin",
        "content_admin",
        "org_exec",
        "org_manager",
      ],
      cloud_provider: ["azure", "aws", "gcp"],
      template_assignee_type: ["user", "org", "group", "self_enroll"],
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
