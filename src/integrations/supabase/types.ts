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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      access_requests: {
        Row: {
          created_at: string
          id: string
          reason: string | null
          requester_id: string
          resource_id: string
          resource_type: string
          review_note: string | null
          reviewed_at: string | null
          reviewer_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          reason?: string | null
          requester_id: string
          resource_id: string
          resource_type: string
          review_note?: string | null
          reviewed_at?: string | null
          reviewer_id?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          reason?: string | null
          requester_id?: string
          resource_id?: string
          resource_type?: string
          review_note?: string | null
          reviewed_at?: string | null
          reviewer_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
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
          desktop_lab_template_id: string | null
          guided: boolean
          id: string
          max_sessions: number | null
          name: string
          org_id: string | null
          provider: Database["public"]["Enums"]["cloud_provider"]
          provider_account_id: string | null
          provider_config: Json
          refresh_allowed: boolean
          region: string | null
          self_enroll: boolean
          session_duration_minutes: number
          sessions_used: number
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
          desktop_lab_template_id?: string | null
          guided?: boolean
          id?: string
          max_sessions?: number | null
          name: string
          org_id?: string | null
          provider: Database["public"]["Enums"]["cloud_provider"]
          provider_account_id?: string | null
          provider_config?: Json
          refresh_allowed?: boolean
          region?: string | null
          self_enroll?: boolean
          session_duration_minutes?: number
          sessions_used?: number
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
          desktop_lab_template_id?: string | null
          guided?: boolean
          id?: string
          max_sessions?: number | null
          name?: string
          org_id?: string | null
          provider?: Database["public"]["Enums"]["cloud_provider"]
          provider_account_id?: string | null
          provider_config?: Json
          refresh_allowed?: boolean
          region?: string | null
          self_enroll?: boolean
          session_duration_minutes?: number
          sessions_used?: number
          status?: Database["public"]["Enums"]["access_template_status"]
          updated_at?: string
          validity_days?: number
        }
        Relationships: [
          {
            foreignKeyName: "access_templates_desktop_lab_template_id_fkey"
            columns: ["desktop_lab_template_id"]
            isOneToOne: false
            referencedRelation: "lab_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "access_templates_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "access_templates_provider_account_id_fkey"
            columns: ["provider_account_id"]
            isOneToOne: false
            referencedRelation: "cloud_provider_accounts"
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
      admin_audit_logs: {
        Row: {
          action: string
          actor_email: string | null
          actor_id: string | null
          actor_type: string
          changes: Json
          correlation_id: string | null
          created_at: string
          entity_id: string | null
          entity_label: string | null
          entity_type: string
          id: string
          message: string | null
          outcome: string
        }
        Insert: {
          action: string
          actor_email?: string | null
          actor_id?: string | null
          actor_type?: string
          changes?: Json
          correlation_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_label?: string | null
          entity_type: string
          id?: string
          message?: string | null
          outcome?: string
        }
        Update: {
          action?: string
          actor_email?: string | null
          actor_id?: string | null
          actor_type?: string
          changes?: Json
          correlation_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_label?: string | null
          entity_type?: string
          id?: string
          message?: string | null
          outcome?: string
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
      app_user_connections: {
        Row: {
          connection_key_ciphertext: string
          connector_id: string
          created_at: string
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          connection_key_ciphertext: string
          connector_id: string
          created_at?: string
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          connection_key_ciphertext?: string
          connector_id?: string
          created_at?: string
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      capacity_cost_alerts: {
        Row: {
          created_at: string
          id: string
          kind: string
          message: string
          metric: string
          notified: number
          region: string | null
          severity: string
          threshold: number
          value: number
        }
        Insert: {
          created_at?: string
          id?: string
          kind: string
          message: string
          metric: string
          notified?: number
          region?: string | null
          severity?: string
          threshold: number
          value: number
        }
        Update: {
          created_at?: string
          id?: string
          kind?: string
          message?: string
          metric?: string
          notified?: number
          region?: string | null
          severity?: string
          threshold?: number
          value?: number
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
      cloud_provider_accounts: {
        Row: {
          config: Json
          created_at: string
          created_by: string | null
          credentials: Json
          default_region: string | null
          description: string | null
          display_name: string
          id: string
          is_default: boolean
          last_test_message: string | null
          last_test_status: string | null
          last_tested_at: string | null
          provider: Database["public"]["Enums"]["cloud_provider"]
          slug: string
          status: string
          updated_at: string
        }
        Insert: {
          config?: Json
          created_at?: string
          created_by?: string | null
          credentials?: Json
          default_region?: string | null
          description?: string | null
          display_name: string
          id?: string
          is_default?: boolean
          last_test_message?: string | null
          last_test_status?: string | null
          last_tested_at?: string | null
          provider: Database["public"]["Enums"]["cloud_provider"]
          slug: string
          status?: string
          updated_at?: string
        }
        Update: {
          config?: Json
          created_at?: string
          created_by?: string | null
          credentials?: Json
          default_region?: string | null
          description?: string | null
          display_name?: string
          id?: string
          is_default?: boolean
          last_test_message?: string | null
          last_test_status?: string | null
          last_tested_at?: string | null
          provider?: Database["public"]["Enums"]["cloud_provider"]
          slug?: string
          status?: string
          updated_at?: string
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
      cloud_quota_sync_state: {
        Row: {
          home_region: string | null
          last_fail_at: string | null
          last_ok_at: string | null
          last_reason: string | null
          last_status: string
          last_synced_at: string | null
          provider: string
          snapshot: Json
          updated_at: string
        }
        Insert: {
          home_region?: string | null
          last_fail_at?: string | null
          last_ok_at?: string | null
          last_reason?: string | null
          last_status?: string
          last_synced_at?: string | null
          provider: string
          snapshot?: Json
          updated_at?: string
        }
        Update: {
          home_region?: string | null
          last_fail_at?: string | null
          last_ok_at?: string | null
          last_reason?: string | null
          last_status?: string
          last_synced_at?: string | null
          provider?: string
          snapshot?: Json
          updated_at?: string
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
      export_audit_logs: {
        Row: {
          actor_email: string | null
          actor_id: string
          actor_role: string | null
          created_at: string
          export_kind: string
          filters: Json
          format: string
          id: string
          ip_address: string | null
          row_count: number
          user_agent: string | null
        }
        Insert: {
          actor_email?: string | null
          actor_id: string
          actor_role?: string | null
          created_at?: string
          export_kind: string
          filters?: Json
          format: string
          id?: string
          ip_address?: string | null
          row_count?: number
          user_agent?: string | null
        }
        Update: {
          actor_email?: string | null
          actor_id?: string
          actor_role?: string | null
          created_at?: string
          export_kind?: string
          filters?: Json
          format?: string
          id?: string
          ip_address?: string | null
          row_count?: number
          user_agent?: string | null
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
      lab_folder_notes: {
        Row: {
          created_at: string
          id: string
          lab_template_id: string
          note: string | null
          path: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          lab_template_id: string
          note?: string | null
          path: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          lab_template_id?: string
          note?: string | null
          path?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lab_folder_notes_lab_template_id_fkey"
            columns: ["lab_template_id"]
            isOneToOne: false
            referencedRelation: "lab_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      lab_guide_steps: {
        Row: {
          body: Json
          command: string | null
          created_at: string
          guide_id: string
          heading: string | null
          id: string
          image_path: string | null
          note: string | null
          position: number
          updated_at: string
        }
        Insert: {
          body?: Json
          command?: string | null
          created_at?: string
          guide_id: string
          heading?: string | null
          id?: string
          image_path?: string | null
          note?: string | null
          position: number
          updated_at?: string
        }
        Update: {
          body?: Json
          command?: string | null
          created_at?: string
          guide_id?: string
          heading?: string | null
          id?: string
          image_path?: string | null
          note?: string | null
          position?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lab_guide_steps_guide_id_fkey"
            columns: ["guide_id"]
            isOneToOne: false
            referencedRelation: "lab_guides"
            referencedColumns: ["id"]
          },
        ]
      }
      lab_guides: {
        Row: {
          access_template_id: string | null
          cleanup: Json
          created_at: string
          difficulty: string | null
          duration_min: number | null
          id: string
          imported_at: string | null
          imported_by: string | null
          lab_template_id: string | null
          objective: string | null
          prerequisites: Json
          reference_links: Json
          source: string
          source_page_id: string | null
          source_page_url: string | null
          status: string
          tags: Json
          title: string
          updated_at: string
          validation: Json
          validation_report: Json
        }
        Insert: {
          access_template_id?: string | null
          cleanup?: Json
          created_at?: string
          difficulty?: string | null
          duration_min?: number | null
          id?: string
          imported_at?: string | null
          imported_by?: string | null
          lab_template_id?: string | null
          objective?: string | null
          prerequisites?: Json
          reference_links?: Json
          source?: string
          source_page_id?: string | null
          source_page_url?: string | null
          status?: string
          tags?: Json
          title: string
          updated_at?: string
          validation?: Json
          validation_report?: Json
        }
        Update: {
          access_template_id?: string | null
          cleanup?: Json
          created_at?: string
          difficulty?: string | null
          duration_min?: number | null
          id?: string
          imported_at?: string | null
          imported_by?: string | null
          lab_template_id?: string | null
          objective?: string | null
          prerequisites?: Json
          reference_links?: Json
          source?: string
          source_page_id?: string | null
          source_page_url?: string | null
          status?: string
          tags?: Json
          title?: string
          updated_at?: string
          validation?: Json
          validation_report?: Json
        }
        Relationships: [
          {
            foreignKeyName: "lab_guides_access_template_id_fkey"
            columns: ["access_template_id"]
            isOneToOne: false
            referencedRelation: "access_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lab_guides_lab_template_id_fkey"
            columns: ["lab_template_id"]
            isOneToOne: false
            referencedRelation: "lab_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      lab_template_bindings: {
        Row: {
          blockers: Json
          config: Json
          created_at: string
          created_by: string | null
          id: string
          lab_template_id: string
          last_checked_at: string | null
          provider: string
          provider_account_id: string | null
          status: string
          updated_at: string
          updated_by: string | null
          warnings: Json
        }
        Insert: {
          blockers?: Json
          config?: Json
          created_at?: string
          created_by?: string | null
          id?: string
          lab_template_id: string
          last_checked_at?: string | null
          provider: string
          provider_account_id?: string | null
          status?: string
          updated_at?: string
          updated_by?: string | null
          warnings?: Json
        }
        Update: {
          blockers?: Json
          config?: Json
          created_at?: string
          created_by?: string | null
          id?: string
          lab_template_id?: string
          last_checked_at?: string | null
          provider?: string
          provider_account_id?: string | null
          status?: string
          updated_at?: string
          updated_by?: string | null
          warnings?: Json
        }
        Relationships: [
          {
            foreignKeyName: "lab_template_bindings_lab_template_id_fkey"
            columns: ["lab_template_id"]
            isOneToOne: false
            referencedRelation: "lab_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lab_template_bindings_provider_account_id_fkey"
            columns: ["provider_account_id"]
            isOneToOne: false
            referencedRelation: "cloud_provider_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      lab_template_folders: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          lab_template_id: string
          path: string
          sort_order: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          lab_template_id: string
          path: string
          sort_order?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          lab_template_id?: string
          path?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "lab_template_folders_lab_template_id_fkey"
            columns: ["lab_template_id"]
            isOneToOne: false
            referencedRelation: "lab_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      lab_template_secrets: {
        Row: {
          created_at: string
          created_by: string | null
          hint: string | null
          id: string
          lab_template_id: string
          label: string
          secret_value: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          hint?: string | null
          id?: string
          lab_template_id: string
          label: string
          secret_value: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          hint?: string | null
          id?: string
          lab_template_id?: string
          label?: string
          secret_value?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lab_template_secrets_lab_template_id_fkey"
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
          end_date: string | null
          file_transfer_enabled: boolean
          gallery_image_id: string | null
          gallery_image_label: string | null
          guided: boolean
          id: string
          idle_timeout: number
          is_persistent: boolean
          name: string
          os_image: string
          protocol: string
          provider: Database["public"]["Enums"]["cloud_provider"]
          provider_account_id: string | null
          region: string
          start_date: string | null
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
          end_date?: string | null
          file_transfer_enabled?: boolean
          gallery_image_id?: string | null
          gallery_image_label?: string | null
          guided?: boolean
          id?: string
          idle_timeout?: number
          is_persistent?: boolean
          name: string
          os_image?: string
          protocol: string
          provider?: Database["public"]["Enums"]["cloud_provider"]
          provider_account_id?: string | null
          region?: string
          start_date?: string | null
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
          end_date?: string | null
          file_transfer_enabled?: boolean
          gallery_image_id?: string | null
          gallery_image_label?: string | null
          guided?: boolean
          id?: string
          idle_timeout?: number
          is_persistent?: boolean
          name?: string
          os_image?: string
          protocol?: string
          provider?: Database["public"]["Enums"]["cloud_provider"]
          provider_account_id?: string | null
          region?: string
          start_date?: string | null
          status?: string
          updated_at?: string
          vm_size?: string
        }
        Relationships: [
          {
            foreignKeyName: "lab_templates_provider_account_id_fkey"
            columns: ["provider_account_id"]
            isOneToOne: false
            referencedRelation: "cloud_provider_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      manual_access_grants: {
        Row: {
          active: boolean
          approval_status: string
          asset_id: string | null
          asset_type: string | null
          certification_slug: string | null
          created_at: string
          ends_at: string | null
          granted_by: string | null
          id: string
          note: string | null
          plan_key: string | null
          review_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          source: string
          starts_at: string
          updated_at: string
          user_id: string
        }
        Insert: {
          active?: boolean
          approval_status?: string
          asset_id?: string | null
          asset_type?: string | null
          certification_slug?: string | null
          created_at?: string
          ends_at?: string | null
          granted_by?: string | null
          id?: string
          note?: string | null
          plan_key?: string | null
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          source?: string
          starts_at?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          active?: boolean
          approval_status?: string
          asset_id?: string | null
          asset_type?: string | null
          certification_slug?: string | null
          created_at?: string
          ends_at?: string | null
          granted_by?: string | null
          id?: string
          note?: string | null
          plan_key?: string | null
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          source?: string
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
      platform_application_launch_events: {
        Row: {
          created_at: string
          generated_email: string | null
          id: string
          launch_type: string
          launch_url: string
          user_id: string
          workspace_id: string | null
          workspace_name: string
        }
        Insert: {
          created_at?: string
          generated_email?: string | null
          id?: string
          launch_type?: string
          launch_url: string
          user_id: string
          workspace_id?: string | null
          workspace_name: string
        }
        Update: {
          created_at?: string
          generated_email?: string | null
          id?: string
          launch_type?: string
          launch_url?: string
          user_id?: string
          workspace_id?: string | null
          workspace_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "platform_application_launch_events_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "platform_applications"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_applications: {
        Row: {
          access_note: string | null
          category: string
          created_at: string
          created_by: string | null
          description: string
          icon: string
          icon_color: string
          icon_label: string
          id: string
          launch_url: string
          login_binding_note: string
          name: string
          password_placeholder: string
          slug: string
          status: string
          trial_signup_url: string | null
          updated_at: string
          updated_by: string | null
          username_placeholder: string
          workspace_email_enabled: boolean
        }
        Insert: {
          access_note?: string | null
          category?: string
          created_at?: string
          created_by?: string | null
          description?: string
          icon?: string
          icon_color?: string
          icon_label?: string
          id?: string
          launch_url: string
          login_binding_note?: string
          name: string
          password_placeholder?: string
          slug: string
          status?: string
          trial_signup_url?: string | null
          updated_at?: string
          updated_by?: string | null
          username_placeholder?: string
          workspace_email_enabled?: boolean
        }
        Update: {
          access_note?: string | null
          category?: string
          created_at?: string
          created_by?: string | null
          description?: string
          icon?: string
          icon_color?: string
          icon_label?: string
          id?: string
          launch_url?: string
          login_binding_note?: string
          name?: string
          password_placeholder?: string
          slug?: string
          status?: string
          trial_signup_url?: string | null
          updated_at?: string
          updated_by?: string | null
          username_placeholder?: string
          workspace_email_enabled?: boolean
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
          gcp_principal_email: string | null
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
          gcp_principal_email?: string | null
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
          gcp_principal_email?: string | null
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
          actor_id: string | null
          actor_type: string
          attempts: number
          completed_at: string | null
          correlation_id: string | null
          created_at: string
          expires_at: string
          id: string
          idempotency_key: string
          last_error: string | null
          last_retried_at: string | null
          last_retried_by: string | null
          response: Json | null
          status: string
          user_id: string
          vm_id: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          actor_type?: string
          attempts?: number
          completed_at?: string | null
          correlation_id?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          idempotency_key: string
          last_error?: string | null
          last_retried_at?: string | null
          last_retried_by?: string | null
          response?: Json | null
          status?: string
          user_id: string
          vm_id?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          actor_type?: string
          attempts?: number
          completed_at?: string | null
          correlation_id?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          idempotency_key?: string
          last_error?: string | null
          last_retried_at?: string | null
          last_retried_by?: string | null
          response?: Json | null
          status?: string
          user_id?: string
          vm_id?: string | null
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
      quota_increase_requests: {
        Row: {
          completed_at: string | null
          created_at: string
          created_by: string | null
          current_limit: number | null
          id: string
          justification: string | null
          provider: string
          region: string
          requested_limit: number
          resource_name: string
          status: string
          submitted_at: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          current_limit?: number | null
          id?: string
          justification?: string | null
          provider: string
          region: string
          requested_limit: number
          resource_name: string
          status?: string
          submitted_at?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          current_limit?: number | null
          id?: string
          justification?: string | null
          provider?: string
          region?: string
          requested_limit?: number
          resource_name?: string
          status?: string
          submitted_at?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      readiness_metrics: {
        Row: {
          bucket_minute: string
          count: number
          created_at: string
          id: string
          metric: string
          provider: string | null
          template_id: string | null
          updated_at: string
        }
        Insert: {
          bucket_minute: string
          count?: number
          created_at?: string
          id?: string
          metric: string
          provider?: string | null
          template_id?: string | null
          updated_at?: string
        }
        Update: {
          bucket_minute?: string
          count?: number
          created_at?: string
          id?: string
          metric?: string
          provider?: string | null
          template_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      reconcile_audit_trail: {
        Row: {
          attempt: number
          backoff_delay_ms: number | null
          correlation_id: string | null
          created_at: string
          detail: Json
          entity_label: string | null
          error_cause: string | null
          error_message: string | null
          from_state: string | null
          id: string
          lab_template_id: string | null
          max_attempts: number
          outcome: string
          provider: string
          region: string | null
          step: string
          to_state: string | null
          vm_id: string | null
        }
        Insert: {
          attempt?: number
          backoff_delay_ms?: number | null
          correlation_id?: string | null
          created_at?: string
          detail?: Json
          entity_label?: string | null
          error_cause?: string | null
          error_message?: string | null
          from_state?: string | null
          id?: string
          lab_template_id?: string | null
          max_attempts?: number
          outcome?: string
          provider?: string
          region?: string | null
          step: string
          to_state?: string | null
          vm_id?: string | null
        }
        Update: {
          attempt?: number
          backoff_delay_ms?: number | null
          correlation_id?: string | null
          created_at?: string
          detail?: Json
          entity_label?: string | null
          error_cause?: string | null
          error_message?: string | null
          from_state?: string | null
          id?: string
          lab_template_id?: string | null
          max_attempts?: number
          outcome?: string
          provider?: string
          region?: string | null
          step?: string
          to_state?: string | null
          vm_id?: string | null
        }
        Relationships: []
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
          disconnect_reason: string | null
          disconnects: number
          ended_at: string | null
          guac_connection_id: string | null
          guac_username: string | null
          id: string
          idle_minutes: number
          lab_template_id: string | null
          last_activity_at: string | null
          reconnects: number
          region: string
          started_at: string
          status: string
          user_id: string | null
          vm_id: string | null
        }
        Insert: {
          connection_quality?: string
          disconnect_reason?: string | null
          disconnects?: number
          ended_at?: string | null
          guac_connection_id?: string | null
          guac_username?: string | null
          id?: string
          idle_minutes?: number
          lab_template_id?: string | null
          last_activity_at?: string | null
          reconnects?: number
          region?: string
          started_at?: string
          status?: string
          user_id?: string | null
          vm_id?: string | null
        }
        Update: {
          connection_quality?: string
          disconnect_reason?: string | null
          disconnects?: number
          ended_at?: string | null
          guac_connection_id?: string | null
          guac_username?: string | null
          id?: string
          idle_minutes?: number
          lab_template_id?: string | null
          last_activity_at?: string | null
          reconnects?: number
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
      skilltrack_handoff_events: {
        Row: {
          captured_at: string | null
          cert: string | null
          created_at: string
          email: string | null
          handoff: string | null
          id: string
          invoice: string | null
          lead: string | null
          phone: string | null
          sku: string | null
          user_id: string | null
        }
        Insert: {
          captured_at?: string | null
          cert?: string | null
          created_at?: string
          email?: string | null
          handoff?: string | null
          id?: string
          invoice?: string | null
          lead?: string | null
          phone?: string | null
          sku?: string | null
          user_id?: string | null
        }
        Update: {
          captured_at?: string | null
          cert?: string | null
          created_at?: string
          email?: string | null
          handoff?: string | null
          id?: string
          invoice?: string | null
          lead?: string | null
          phone?: string | null
          sku?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      skilltrack_sku_map: {
        Row: {
          access_template_id: string | null
          active: boolean
          certification_slug: string | null
          created_at: string
          created_by: string | null
          id: string
          lab_template_id: string | null
          label: string | null
          note: string | null
          sku: string
          updated_at: string
        }
        Insert: {
          access_template_id?: string | null
          active?: boolean
          certification_slug?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          lab_template_id?: string | null
          label?: string | null
          note?: string | null
          sku: string
          updated_at?: string
        }
        Update: {
          access_template_id?: string | null
          active?: boolean
          certification_slug?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          lab_template_id?: string | null
          label?: string | null
          note?: string | null
          sku?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "skilltrack_sku_map_access_template_id_fkey"
            columns: ["access_template_id"]
            isOneToOne: false
            referencedRelation: "access_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "skilltrack_sku_map_lab_template_id_fkey"
            columns: ["lab_template_id"]
            isOneToOne: false
            referencedRelation: "lab_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      student_lab_assignment_audit: {
        Row: {
          action: string
          actor_id: string | null
          assignment_id: string | null
          created_at: string
          detail: Json
          id: string
          lab_template_id: string
          student_id: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          assignment_id?: string | null
          created_at?: string
          detail?: Json
          id?: string
          lab_template_id: string
          student_id: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          assignment_id?: string | null
          created_at?: string
          detail?: Json
          id?: string
          lab_template_id?: string
          student_id?: string
        }
        Relationships: []
      }
      student_lab_assignments: {
        Row: {
          assigned_at: string
          assigned_by: string | null
          id: string
          lab_template_id: string
          revoked_at: string | null
          student_id: string
        }
        Insert: {
          assigned_at?: string
          assigned_by?: string | null
          id?: string
          lab_template_id: string
          revoked_at?: string | null
          student_id: string
        }
        Update: {
          assigned_at?: string
          assigned_by?: string | null
          id?: string
          lab_template_id?: string
          revoked_at?: string | null
          student_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "student_lab_assignments_lab_template_id_fkey"
            columns: ["lab_template_id"]
            isOneToOne: false
            referencedRelation: "lab_templates"
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
      template_access_audit: {
        Row: {
          action: string
          actor_email: string | null
          actor_id: string | null
          assignee_email: string | null
          assignee_id: string | null
          assignee_type: string
          assignment_id: string | null
          azure_object_id_present: boolean
          created_at: string
          detail: Json
          gcp_principal_email_present: boolean
          id: string
          provider: string | null
          template_id: string
          template_name: string | null
        }
        Insert: {
          action: string
          actor_email?: string | null
          actor_id?: string | null
          assignee_email?: string | null
          assignee_id?: string | null
          assignee_type: string
          assignment_id?: string | null
          azure_object_id_present?: boolean
          created_at?: string
          detail?: Json
          gcp_principal_email_present?: boolean
          id?: string
          provider?: string | null
          template_id: string
          template_name?: string | null
        }
        Update: {
          action?: string
          actor_email?: string | null
          actor_id?: string | null
          assignee_email?: string | null
          assignee_id?: string | null
          assignee_type?: string
          assignment_id?: string | null
          azure_object_id_present?: boolean
          created_at?: string
          detail?: Json
          gcp_principal_email_present?: boolean
          id?: string
          provider?: string | null
          template_id?: string
          template_name?: string | null
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
      template_seat_events: {
        Row: {
          actor_id: string | null
          created_at: string
          event_type: string
          id: string
          max_sessions: number | null
          provider: string | null
          reason: string | null
          region: string | null
          seats_delta: number
          session_id: string | null
          sessions_used_after: number | null
          template_id: string
          template_name: string | null
          user_id: string | null
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          event_type: string
          id?: string
          max_sessions?: number | null
          provider?: string | null
          reason?: string | null
          region?: string | null
          seats_delta?: number
          session_id?: string | null
          sessions_used_after?: number | null
          template_id: string
          template_name?: string | null
          user_id?: string | null
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          event_type?: string
          id?: string
          max_sessions?: number | null
          provider?: string | null
          reason?: string | null
          region?: string | null
          seats_delta?: number
          session_id?: string | null
          sessions_used_after?: number | null
          template_id?: string
          template_name?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "template_seat_events_template_id_fkey"
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
          cost_currency: string
          created_at: string
          ended_at: string | null
          ended_by: string | null
          ended_reason: string | null
          expires_at: string | null
          expiry_warned_at: string | null
          hourly_rate: number | null
          id: string
          idle_minutes: number
          lab_template_id: string | null
          network_info: Json
          private_ip: string | null
          provider: string
          provider_account_id: string | null
          public_ip: string | null
          region: string
          resource_tags: Json
          status: Database["public"]["Enums"]["vm_status"]
          updated_at: string
          user_id: string | null
          vm_size: string
        }
        Insert: {
          azure_vm_id?: string | null
          cost_currency?: string
          created_at?: string
          ended_at?: string | null
          ended_by?: string | null
          ended_reason?: string | null
          expires_at?: string | null
          expiry_warned_at?: string | null
          hourly_rate?: number | null
          id?: string
          idle_minutes?: number
          lab_template_id?: string | null
          network_info?: Json
          private_ip?: string | null
          provider?: string
          provider_account_id?: string | null
          public_ip?: string | null
          region?: string
          resource_tags?: Json
          status?: Database["public"]["Enums"]["vm_status"]
          updated_at?: string
          user_id?: string | null
          vm_size?: string
        }
        Update: {
          azure_vm_id?: string | null
          cost_currency?: string
          created_at?: string
          ended_at?: string | null
          ended_by?: string | null
          ended_reason?: string | null
          expires_at?: string | null
          expiry_warned_at?: string | null
          hourly_rate?: number | null
          id?: string
          idle_minutes?: number
          lab_template_id?: string | null
          network_info?: Json
          private_ip?: string | null
          provider?: string
          provider_account_id?: string | null
          public_ip?: string | null
          region?: string
          resource_tags?: Json
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
          {
            foreignKeyName: "virtual_machines_provider_account_id_fkey"
            columns: ["provider_account_id"]
            isOneToOne: false
            referencedRelation: "cloud_provider_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      vm_access_credentials: {
        Row: {
          created_at: string
          password: string
          username: string
          vm_id: string
        }
        Insert: {
          created_at?: string
          password: string
          username: string
          vm_id: string
        }
        Update: {
          created_at?: string
          password?: string
          username?: string
          vm_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vm_access_credentials_vm_id_fkey"
            columns: ["vm_id"]
            isOneToOne: true
            referencedRelation: "virtual_machines"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_assignments: {
        Row: {
          assigned_at: string
          assigned_by: string | null
          created_at: string
          id: string
          revoked_at: string | null
          updated_at: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          assigned_at?: string
          assigned_by?: string | null
          created_at?: string
          id?: string
          revoked_at?: string | null
          updated_at?: string
          user_id: string
          workspace_id: string
        }
        Update: {
          assigned_at?: string
          assigned_by?: string | null
          created_at?: string
          id?: string
          revoked_at?: string | null
          updated_at?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_assignments_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "platform_applications"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_credential_events: {
        Row: {
          created_at: string
          credential_id: string | null
          detail: Json
          event_type: string
          id: string
          user_id: string
          workspace_id: string | null
          workspace_name: string
        }
        Insert: {
          created_at?: string
          credential_id?: string | null
          detail?: Json
          event_type: string
          id?: string
          user_id: string
          workspace_id?: string | null
          workspace_name: string
        }
        Update: {
          created_at?: string
          credential_id?: string | null
          detail?: Json
          event_type?: string
          id?: string
          user_id?: string
          workspace_id?: string | null
          workspace_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_credential_events_credential_id_fkey"
            columns: ["credential_id"]
            isOneToOne: false
            referencedRelation: "workspace_credentials"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_credential_events_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "platform_applications"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_credentials: {
        Row: {
          created_at: string
          expires_at: string
          id: string
          issued_at: string
          password: string
          regenerated_count: number
          updated_at: string
          user_id: string
          username: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          expires_at: string
          id?: string
          issued_at?: string
          password: string
          regenerated_count?: number
          updated_at?: string
          user_id: string
          username: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          id?: string
          issued_at?: string
          password?: string
          regenerated_count?: number
          updated_at?: string
          user_id?: string
          username?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_credentials_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "platform_applications"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_favorites: {
        Row: {
          created_at: string
          id: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          user_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          id?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_favorites_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "platform_applications"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_trial_identities: {
        Row: {
          created_at: string
          generated_email: string
          id: string
          provisioned_at: string | null
          provisioning_detail: string | null
          provisioning_provider: string | null
          provisioning_status: string
          updated_at: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          generated_email: string
          id?: string
          provisioned_at?: string | null
          provisioning_detail?: string | null
          provisioning_provider?: string | null
          provisioning_status?: string
          updated_at?: string
          user_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          generated_email?: string
          id?: string
          provisioned_at?: string | null
          provisioning_detail?: string | null
          provisioning_provider?: string | null
          provisioning_status?: string
          updated_at?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_trial_identities_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "platform_applications"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      can_review_access_request: {
        Args: { _resource_id: string; _resource_type: string; _user_id: string }
        Returns: boolean
      }
      consume_template_session_quota: {
        Args: {
          _region?: string
          _session_id?: string
          _template_id: string
          _user_id?: string
        }
        Returns: Json
      }
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
      reactivate_template_session_pool: {
        Args: {
          _max_sessions?: number
          _reason?: string
          _target_status?: string
          _template_id: string
        }
        Returns: Json
      }
      record_readiness_metric: {
        Args: {
          _count?: number
          _metric: string
          _provider?: string
          _template_id?: string
        }
        Returns: undefined
      }
      record_template_seat_admin_event: {
        Args: { _event_type: string; _reason?: string; _template_id: string }
        Returns: undefined
      }
      release_template_session_quota: {
        Args: {
          _reason?: string
          _session_id?: string
          _template_id: string
          _user_id?: string
        }
        Returns: Json
      }
      search_workspaces: {
        Args: {
          _category?: string
          _limit?: number
          _offset?: number
          _search?: string
        }
        Returns: {
          total_count: number
          workspace: Json
        }[]
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      user_can_access_lab_template: {
        Args: { _lab_template_id: string; _user_id: string }
        Returns: boolean
      }
      user_can_access_template: {
        Args: { _template_id: string; _user_id: string }
        Returns: boolean
      }
      user_can_access_workspace: {
        Args: { _user_id: string; _workspace_id: string }
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
      cloud_provider:
        | "azure"
        | "aws"
        | "gcp"
        | "oci"
        | "ibm"
        | "alibaba"
        | "digitalocean"
        | "other"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
      cloud_provider: [
        "azure",
        "aws",
        "gcp",
        "oci",
        "ibm",
        "alibaba",
        "digitalocean",
        "other",
      ],
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
