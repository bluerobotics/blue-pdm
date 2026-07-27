export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: '13.0.5'
  }
  public: {
    Tables: {
      activity: {
        Row: {
          action: Database['public']['Enums']['activity_action']
          created_at: string | null
          details: Json | null
          file_id: string | null
          id: string
          org_id: string
          user_email: string
          user_id: string
        }
        Insert: {
          action: Database['public']['Enums']['activity_action']
          created_at?: string | null
          details?: Json | null
          file_id?: string | null
          id?: string
          org_id: string
          user_email: string
          user_id: string
        }
        Update: {
          action?: Database['public']['Enums']['activity_action']
          created_at?: string | null
          details?: Json | null
          file_id?: string | null
          id?: string
          org_id?: string
          user_email?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'activity_file_id_fkey'
            columns: ['file_id']
            isOneToOne: false
            referencedRelation: 'files'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'activity_file_id_fkey'
            columns: ['file_id']
            isOneToOne: false
            referencedRelation: 'parts_with_pricing'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'activity_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'activity_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
        ]
      }
      admin_recovery_codes: {
        Row: {
          code_hash: string
          created_at: string | null
          created_by: string
          description: string | null
          expires_at: string
          id: string
          is_revoked: boolean | null
          is_used: boolean | null
          org_id: string
          revoke_reason: string | null
          revoked_at: string | null
          revoked_by: string | null
          used_at: string | null
          used_by: string | null
          used_from_ip: string | null
        }
        Insert: {
          code_hash: string
          created_at?: string | null
          created_by: string
          description?: string | null
          expires_at: string
          id?: string
          is_revoked?: boolean | null
          is_used?: boolean | null
          org_id: string
          revoke_reason?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          used_at?: string | null
          used_by?: string | null
          used_from_ip?: string | null
        }
        Update: {
          code_hash?: string
          created_at?: string | null
          created_by?: string
          description?: string | null
          expires_at?: string
          id?: string
          is_revoked?: boolean | null
          is_used?: boolean | null
          org_id?: string
          revoke_reason?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          used_at?: string | null
          used_by?: string | null
          used_from_ip?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'admin_recovery_codes_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'admin_recovery_codes_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'admin_recovery_codes_revoked_by_fkey'
            columns: ['revoked_by']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'admin_recovery_codes_used_by_fkey'
            columns: ['used_by']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
        ]
      }
      backup_config: {
        Row: {
          access_key_encrypted: string | null
          backup_requested_at: string | null
          backup_requested_by: string | null
          backup_running_since: string | null
          bucket: string | null
          created_at: string | null
          designated_machine_id: string | null
          designated_machine_last_seen: string | null
          designated_machine_name: string | null
          designated_machine_platform: string | null
          designated_machine_user_email: string | null
          endpoint: string | null
          id: string
          org_id: string
          provider: string
          region: string | null
          restic_password_encrypted: string | null
          retention_daily: number | null
          retention_monthly: number | null
          retention_weekly: number | null
          retention_yearly: number | null
          schedule_cron: string | null
          schedule_enabled: boolean | null
          schedule_hour: number | null
          schedule_minute: number | null
          schedule_timezone: string | null
          secret_key_encrypted: string | null
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          access_key_encrypted?: string | null
          backup_requested_at?: string | null
          backup_requested_by?: string | null
          backup_running_since?: string | null
          bucket?: string | null
          created_at?: string | null
          designated_machine_id?: string | null
          designated_machine_last_seen?: string | null
          designated_machine_name?: string | null
          designated_machine_platform?: string | null
          designated_machine_user_email?: string | null
          endpoint?: string | null
          id?: string
          org_id: string
          provider?: string
          region?: string | null
          restic_password_encrypted?: string | null
          retention_daily?: number | null
          retention_monthly?: number | null
          retention_weekly?: number | null
          retention_yearly?: number | null
          schedule_cron?: string | null
          schedule_enabled?: boolean | null
          schedule_hour?: number | null
          schedule_minute?: number | null
          schedule_timezone?: string | null
          secret_key_encrypted?: string | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          access_key_encrypted?: string | null
          backup_requested_at?: string | null
          backup_requested_by?: string | null
          backup_running_since?: string | null
          bucket?: string | null
          created_at?: string | null
          designated_machine_id?: string | null
          designated_machine_last_seen?: string | null
          designated_machine_name?: string | null
          designated_machine_platform?: string | null
          designated_machine_user_email?: string | null
          endpoint?: string | null
          id?: string
          org_id?: string
          provider?: string
          region?: string | null
          restic_password_encrypted?: string | null
          retention_daily?: number | null
          retention_monthly?: number | null
          retention_weekly?: number | null
          retention_yearly?: number | null
          schedule_cron?: string | null
          schedule_enabled?: boolean | null
          schedule_hour?: number | null
          schedule_minute?: number | null
          schedule_timezone?: string | null
          secret_key_encrypted?: string | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'backup_config_org_id_fkey'
            columns: ['org_id']
            isOneToOne: true
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'backup_config_updated_by_fkey'
            columns: ['updated_by']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
        ]
      }
      backup_history: {
        Row: {
          bytes_added: number | null
          bytes_total: number | null
          completed_at: string | null
          created_at: string | null
          duration_seconds: number | null
          error_details: Json | null
          error_message: string | null
          files_added: number | null
          files_modified: number | null
          files_total: number | null
          id: string
          machine_id: string
          machine_name: string
          org_id: string
          snapshot_id: string | null
          started_at: string
          status: string
        }
        Insert: {
          bytes_added?: number | null
          bytes_total?: number | null
          completed_at?: string | null
          created_at?: string | null
          duration_seconds?: number | null
          error_details?: Json | null
          error_message?: string | null
          files_added?: number | null
          files_modified?: number | null
          files_total?: number | null
          id?: string
          machine_id: string
          machine_name: string
          org_id: string
          snapshot_id?: string | null
          started_at?: string
          status?: string
        }
        Update: {
          bytes_added?: number | null
          bytes_total?: number | null
          completed_at?: string | null
          created_at?: string | null
          duration_seconds?: number | null
          error_details?: Json | null
          error_message?: string | null
          files_added?: number | null
          files_modified?: number | null
          files_total?: number | null
          id?: string
          machine_id?: string
          machine_name?: string
          org_id?: string
          snapshot_id?: string | null
          started_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: 'backup_history_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
        ]
      }
      backup_locks: {
        Row: {
          backup_history_id: string | null
          expires_at: string
          id: string
          locked_at: string
          locked_by_machine_id: string
          locked_by_machine_name: string
          org_id: string
        }
        Insert: {
          backup_history_id?: string | null
          expires_at: string
          id?: string
          locked_at?: string
          locked_by_machine_id: string
          locked_by_machine_name: string
          org_id: string
        }
        Update: {
          backup_history_id?: string | null
          expires_at?: string
          id?: string
          locked_at?: string
          locked_by_machine_id?: string
          locked_by_machine_name?: string
          org_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'backup_locks_backup_history_id_fkey'
            columns: ['backup_history_id']
            isOneToOne: false
            referencedRelation: 'backup_history'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'backup_locks_org_id_fkey'
            columns: ['org_id']
            isOneToOne: true
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
        ]
      }
      backup_machines: {
        Row: {
          app_version: string | null
          created_at: string | null
          id: string
          is_designated: boolean | null
          last_seen: string
          machine_id: string
          machine_name: string
          org_id: string
          platform: string | null
          user_email: string | null
          user_id: string | null
        }
        Insert: {
          app_version?: string | null
          created_at?: string | null
          id?: string
          is_designated?: boolean | null
          last_seen?: string
          machine_id: string
          machine_name: string
          org_id: string
          platform?: string | null
          user_email?: string | null
          user_id?: string | null
        }
        Update: {
          app_version?: string | null
          created_at?: string | null
          id?: string
          is_designated?: boolean | null
          last_seen?: string
          machine_id?: string
          machine_name?: string
          org_id?: string
          platform?: string | null
          user_email?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'backup_machines_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'backup_machines_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
        ]
      }
      blocked_users: {
        Row: {
          blocked_at: string | null
          blocked_by: string | null
          email: string
          id: string
          org_id: string
          reason: string | null
        }
        Insert: {
          blocked_at?: string | null
          blocked_by?: string | null
          email: string
          id?: string
          org_id: string
          reason?: string | null
        }
        Update: {
          blocked_at?: string | null
          blocked_by?: string | null
          email?: string
          id?: string
          org_id?: string
          reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'blocked_users_blocked_by_fkey'
            columns: ['blocked_by']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'blocked_users_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
        ]
      }
      color_swatches: {
        Row: {
          color: string
          created_at: string | null
          id: string
          name: string | null
          sort_order: number | null
          user_id: string
        }
        Insert: {
          color: string
          created_at?: string | null
          id?: string
          name?: string | null
          sort_order?: number | null
          user_id: string
        }
        Update: {
          color?: string
          created_at?: string | null
          id?: string
          name?: string | null
          sort_order?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'color_swatches_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
        ]
      }
      deviations: {
        Row: {
          affected_part_numbers: string[] | null
          approved_at: string | null
          approved_by: string | null
          created_at: string | null
          created_by: string
          custom_properties: Json | null
          description: string | null
          deviation_number: string
          deviation_type: string | null
          effective_date: string | null
          expiration_date: string | null
          id: string
          org_id: string
          rejection_reason: string | null
          status: Database['public']['Enums']['deviation_status'] | null
          title: string
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          affected_part_numbers?: string[] | null
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string | null
          created_by: string
          custom_properties?: Json | null
          description?: string | null
          deviation_number: string
          deviation_type?: string | null
          effective_date?: string | null
          expiration_date?: string | null
          id?: string
          org_id: string
          rejection_reason?: string | null
          status?: Database['public']['Enums']['deviation_status'] | null
          title: string
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          affected_part_numbers?: string[] | null
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string | null
          created_by?: string
          custom_properties?: Json | null
          description?: string | null
          deviation_number?: string
          deviation_type?: string | null
          effective_date?: string | null
          expiration_date?: string | null
          id?: string
          org_id?: string
          rejection_reason?: string | null
          status?: Database['public']['Enums']['deviation_status'] | null
          title?: string
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'deviations_approved_by_fkey'
            columns: ['approved_by']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'deviations_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'deviations_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'deviations_updated_by_fkey'
            columns: ['updated_by']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
        ]
      }
      eco_checklist_activity: {
        Row: {
          action: string
          checklist_item_id: string | null
          eco_id: string
          gate_approval_id: string | null
          id: string
          new_value: string | null
          notes: string | null
          old_value: string | null
          performed_at: string | null
          performed_by: string | null
        }
        Insert: {
          action: string
          checklist_item_id?: string | null
          eco_id: string
          gate_approval_id?: string | null
          id?: string
          new_value?: string | null
          notes?: string | null
          old_value?: string | null
          performed_at?: string | null
          performed_by?: string | null
        }
        Update: {
          action?: string
          checklist_item_id?: string | null
          eco_id?: string
          gate_approval_id?: string | null
          id?: string
          new_value?: string | null
          notes?: string | null
          old_value?: string | null
          performed_at?: string | null
          performed_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'eco_checklist_activity_checklist_item_id_fkey'
            columns: ['checklist_item_id']
            isOneToOne: false
            referencedRelation: 'eco_checklist_items'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'eco_checklist_activity_eco_id_fkey'
            columns: ['eco_id']
            isOneToOne: false
            referencedRelation: 'ecos'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'eco_checklist_activity_gate_approval_id_fkey'
            columns: ['gate_approval_id']
            isOneToOne: false
            referencedRelation: 'eco_gate_approvals'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'eco_checklist_activity_performed_by_fkey'
            columns: ['performed_by']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
        ]
      }
      eco_checklist_items: {
        Row: {
          accountable_text: string | null
          accountable_user_id: string | null
          completed_at: string | null
          completed_by: string | null
          consulted_text: string | null
          consulted_user_ids: string[] | null
          created_at: string | null
          description: string | null
          doc_number: string | null
          eco_id: string
          gate_name: string | null
          id: string
          informed_text: string | null
          informed_user_ids: string[] | null
          link_file_id: string | null
          link_url: string | null
          name: string
          notes: string | null
          phase_name: string
          phase_sort_order: number | null
          required_for_gate: boolean | null
          responsible_text: string | null
          responsible_user_id: string | null
          sort_order: number
          started_at: string | null
          status: Database['public']['Enums']['checklist_item_status'] | null
          target_date: string | null
          template_item_id: string | null
          uid: string | null
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          accountable_text?: string | null
          accountable_user_id?: string | null
          completed_at?: string | null
          completed_by?: string | null
          consulted_text?: string | null
          consulted_user_ids?: string[] | null
          created_at?: string | null
          description?: string | null
          doc_number?: string | null
          eco_id: string
          gate_name?: string | null
          id?: string
          informed_text?: string | null
          informed_user_ids?: string[] | null
          link_file_id?: string | null
          link_url?: string | null
          name: string
          notes?: string | null
          phase_name: string
          phase_sort_order?: number | null
          required_for_gate?: boolean | null
          responsible_text?: string | null
          responsible_user_id?: string | null
          sort_order?: number
          started_at?: string | null
          status?: Database['public']['Enums']['checklist_item_status'] | null
          target_date?: string | null
          template_item_id?: string | null
          uid?: string | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          accountable_text?: string | null
          accountable_user_id?: string | null
          completed_at?: string | null
          completed_by?: string | null
          consulted_text?: string | null
          consulted_user_ids?: string[] | null
          created_at?: string | null
          description?: string | null
          doc_number?: string | null
          eco_id?: string
          gate_name?: string | null
          id?: string
          informed_text?: string | null
          informed_user_ids?: string[] | null
          link_file_id?: string | null
          link_url?: string | null
          name?: string
          notes?: string | null
          phase_name?: string
          phase_sort_order?: number | null
          required_for_gate?: boolean | null
          responsible_text?: string | null
          responsible_user_id?: string | null
          sort_order?: number
          started_at?: string | null
          status?: Database['public']['Enums']['checklist_item_status'] | null
          target_date?: string | null
          template_item_id?: string | null
          uid?: string | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'eco_checklist_items_accountable_user_id_fkey'
            columns: ['accountable_user_id']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'eco_checklist_items_completed_by_fkey'
            columns: ['completed_by']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'eco_checklist_items_eco_id_fkey'
            columns: ['eco_id']
            isOneToOne: false
            referencedRelation: 'ecos'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'eco_checklist_items_link_file_id_fkey'
            columns: ['link_file_id']
            isOneToOne: false
            referencedRelation: 'files'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'eco_checklist_items_link_file_id_fkey'
            columns: ['link_file_id']
            isOneToOne: false
            referencedRelation: 'parts_with_pricing'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'eco_checklist_items_responsible_user_id_fkey'
            columns: ['responsible_user_id']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'eco_checklist_items_template_item_id_fkey'
            columns: ['template_item_id']
            isOneToOne: false
            referencedRelation: 'process_template_items'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'eco_checklist_items_updated_by_fkey'
            columns: ['updated_by']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
        ]
      }
      eco_gate_approvals: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          created_at: string | null
          eco_id: string
          gate_name: string
          id: string
          is_approved: boolean | null
          notes: string | null
          phase_name: string | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string | null
          eco_id: string
          gate_name: string
          id?: string
          is_approved?: boolean | null
          notes?: string | null
          phase_name?: string | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string | null
          eco_id?: string
          gate_name?: string
          id?: string
          is_approved?: boolean | null
          notes?: string | null
          phase_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'eco_gate_approvals_approved_by_fkey'
            columns: ['approved_by']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'eco_gate_approvals_eco_id_fkey'
            columns: ['eco_id']
            isOneToOne: false
            referencedRelation: 'ecos'
            referencedColumns: ['id']
          },
        ]
      }
      ecos: {
        Row: {
          completed_at: string | null
          created_at: string | null
          created_by: string
          custom_properties: Json | null
          description: string | null
          eco_number: string
          id: string
          org_id: string
          process_template_id: string | null
          status: Database['public']['Enums']['eco_status'] | null
          title: string | null
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          completed_at?: string | null
          created_at?: string | null
          created_by: string
          custom_properties?: Json | null
          description?: string | null
          eco_number: string
          id?: string
          org_id: string
          process_template_id?: string | null
          status?: Database['public']['Enums']['eco_status'] | null
          title?: string | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          completed_at?: string | null
          created_at?: string | null
          created_by?: string
          custom_properties?: Json | null
          description?: string | null
          eco_number?: string
          id?: string
          org_id?: string
          process_template_id?: string | null
          status?: Database['public']['Enums']['eco_status'] | null
          title?: string | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'ecos_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'ecos_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'ecos_updated_by_fkey'
            columns: ['updated_by']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'fk_ecos_process_template'
            columns: ['process_template_id']
            isOneToOne: false
            referencedRelation: 'process_templates'
            referencedColumns: ['id']
          },
        ]
      }
      file_comments: {
        Row: {
          comment: string
          created_at: string | null
          file_id: string
          id: string
          user_id: string
        }
        Insert: {
          comment: string
          created_at?: string | null
          file_id: string
          id?: string
          user_id: string
        }
        Update: {
          comment?: string
          created_at?: string | null
          file_id?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'file_comments_file_id_fkey'
            columns: ['file_id']
            isOneToOne: false
            referencedRelation: 'files'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'file_comments_file_id_fkey'
            columns: ['file_id']
            isOneToOne: false
            referencedRelation: 'parts_with_pricing'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'file_comments_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
        ]
      }
      file_deviations: {
        Row: {
          created_at: string | null
          created_by: string
          deviation_id: string
          file_id: string
          file_revision: string | null
          file_version: number | null
          id: string
          notes: string | null
        }
        Insert: {
          created_at?: string | null
          created_by: string
          deviation_id: string
          file_id: string
          file_revision?: string | null
          file_version?: number | null
          id?: string
          notes?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string
          deviation_id?: string
          file_id?: string
          file_revision?: string | null
          file_version?: number | null
          id?: string
          notes?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'file_deviations_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'file_deviations_deviation_id_fkey'
            columns: ['deviation_id']
            isOneToOne: false
            referencedRelation: 'deviations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'file_deviations_file_id_fkey'
            columns: ['file_id']
            isOneToOne: false
            referencedRelation: 'files'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'file_deviations_file_id_fkey'
            columns: ['file_id']
            isOneToOne: false
            referencedRelation: 'parts_with_pricing'
            referencedColumns: ['id']
          },
        ]
      }
      file_ecos: {
        Row: {
          created_at: string | null
          created_by: string
          eco_id: string
          file_id: string
          id: string
          notes: string | null
        }
        Insert: {
          created_at?: string | null
          created_by: string
          eco_id: string
          file_id: string
          id?: string
          notes?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string
          eco_id?: string
          file_id?: string
          id?: string
          notes?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'file_ecos_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'file_ecos_eco_id_fkey'
            columns: ['eco_id']
            isOneToOne: false
            referencedRelation: 'ecos'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'file_ecos_file_id_fkey'
            columns: ['file_id']
            isOneToOne: false
            referencedRelation: 'files'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'file_ecos_file_id_fkey'
            columns: ['file_id']
            isOneToOne: false
            referencedRelation: 'parts_with_pricing'
            referencedColumns: ['id']
          },
        ]
      }
      file_metadata_columns: {
        Row: {
          created_at: string | null
          created_by: string | null
          data_type: Database['public']['Enums']['metadata_column_type']
          default_value: string | null
          id: string
          label: string
          name: string
          org_id: string
          required: boolean
          select_options: string[]
          sort_order: number
          sortable: boolean
          updated_at: string | null
          updated_by: string | null
          visible: boolean
          width: number
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          data_type?: Database['public']['Enums']['metadata_column_type']
          default_value?: string | null
          id?: string
          label: string
          name: string
          org_id: string
          required?: boolean
          select_options?: string[]
          sort_order?: number
          sortable?: boolean
          updated_at?: string | null
          updated_by?: string | null
          visible?: boolean
          width?: number
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          data_type?: Database['public']['Enums']['metadata_column_type']
          default_value?: string | null
          id?: string
          label?: string
          name?: string
          org_id?: string
          required?: boolean
          select_options?: string[]
          sort_order?: number
          sortable?: boolean
          updated_at?: string | null
          updated_by?: string | null
          visible?: boolean
          width?: number
        }
        Relationships: [
          {
            foreignKeyName: 'file_metadata_columns_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'file_metadata_columns_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'file_metadata_columns_updated_by_fkey'
            columns: ['updated_by']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
        ]
      }
      file_references: {
        Row: {
          child_file_id: string
          configuration: string | null
          created_at: string | null
          id: string
          org_id: string
          parent_file_id: string
          quantity: number | null
          reference_type: Database['public']['Enums']['reference_type'] | null
          updated_at: string | null
        }
        Insert: {
          child_file_id: string
          configuration?: string | null
          created_at?: string | null
          id?: string
          org_id: string
          parent_file_id: string
          quantity?: number | null
          reference_type?: Database['public']['Enums']['reference_type'] | null
          updated_at?: string | null
        }
        Update: {
          child_file_id?: string
          configuration?: string | null
          created_at?: string | null
          id?: string
          org_id?: string
          parent_file_id?: string
          quantity?: number | null
          reference_type?: Database['public']['Enums']['reference_type'] | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'file_references_child_file_id_fkey'
            columns: ['child_file_id']
            isOneToOne: false
            referencedRelation: 'files'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'file_references_child_file_id_fkey'
            columns: ['child_file_id']
            isOneToOne: false
            referencedRelation: 'parts_with_pricing'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'file_references_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'file_references_parent_file_id_fkey'
            columns: ['parent_file_id']
            isOneToOne: false
            referencedRelation: 'files'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'file_references_parent_file_id_fkey'
            columns: ['parent_file_id']
            isOneToOne: false
            referencedRelation: 'parts_with_pricing'
            referencedColumns: ['id']
          },
        ]
      }
      file_share_links: {
        Row: {
          allow_download: boolean | null
          created_at: string | null
          created_by: string
          download_count: number | null
          expires_at: string | null
          file_id: string
          file_version: number | null
          id: string
          is_active: boolean | null
          last_accessed_at: string | null
          max_downloads: number | null
          org_id: string
          password_hash: string | null
          require_auth: boolean | null
          token: string
        }
        Insert: {
          allow_download?: boolean | null
          created_at?: string | null
          created_by: string
          download_count?: number | null
          expires_at?: string | null
          file_id: string
          file_version?: number | null
          id?: string
          is_active?: boolean | null
          last_accessed_at?: string | null
          max_downloads?: number | null
          org_id: string
          password_hash?: string | null
          require_auth?: boolean | null
          token: string
        }
        Update: {
          allow_download?: boolean | null
          created_at?: string | null
          created_by?: string
          download_count?: number | null
          expires_at?: string | null
          file_id?: string
          file_version?: number | null
          id?: string
          is_active?: boolean | null
          last_accessed_at?: string | null
          max_downloads?: number | null
          org_id?: string
          password_hash?: string | null
          require_auth?: boolean | null
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: 'file_share_links_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'file_share_links_file_id_fkey'
            columns: ['file_id']
            isOneToOne: false
            referencedRelation: 'files'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'file_share_links_file_id_fkey'
            columns: ['file_id']
            isOneToOne: false
            referencedRelation: 'parts_with_pricing'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'file_share_links_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
        ]
      }
      file_state_entries: {
        Row: {
          duration_seconds: number | null
          entered_at: string | null
          entered_by: string | null
          exited_at: string | null
          exited_by: string | null
          file_id: string
          id: string
          state_id: string
        }
        Insert: {
          duration_seconds?: number | null
          entered_at?: string | null
          entered_by?: string | null
          exited_at?: string | null
          exited_by?: string | null
          file_id: string
          id?: string
          state_id: string
        }
        Update: {
          duration_seconds?: number | null
          entered_at?: string | null
          entered_by?: string | null
          exited_at?: string | null
          exited_by?: string | null
          file_id?: string
          id?: string
          state_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'file_state_entries_entered_by_fkey'
            columns: ['entered_by']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'file_state_entries_exited_by_fkey'
            columns: ['exited_by']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'file_state_entries_file_id_fkey'
            columns: ['file_id']
            isOneToOne: false
            referencedRelation: 'files'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'file_state_entries_file_id_fkey'
            columns: ['file_id']
            isOneToOne: false
            referencedRelation: 'parts_with_pricing'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'file_state_entries_state_id_fkey'
            columns: ['state_id']
            isOneToOne: false
            referencedRelation: 'workflow_states'
            referencedColumns: ['id']
          },
        ]
      }
      file_versions: {
        Row: {
          comment: string | null
          content_hash: string
          created_at: string | null
          created_by: string
          description: string | null
          file_id: string
          file_size: number | null
          id: string
          inspection_hash: string | null
          part_number: string | null
          revision: string
          state: string
          version: number
          workflow_state_id: string | null
        }
        Insert: {
          comment?: string | null
          content_hash: string
          created_at?: string | null
          created_by: string
          description?: string | null
          file_id: string
          file_size?: number | null
          id?: string
          inspection_hash?: string | null
          part_number?: string | null
          revision: string
          state?: string
          version: number
          workflow_state_id?: string | null
        }
        Update: {
          comment?: string | null
          content_hash?: string
          created_at?: string | null
          created_by?: string
          description?: string | null
          file_id?: string
          file_size?: number | null
          id?: string
          inspection_hash?: string | null
          part_number?: string | null
          revision?: string
          state?: string
          version?: number
          workflow_state_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'file_versions_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'file_versions_file_id_fkey'
            columns: ['file_id']
            isOneToOne: false
            referencedRelation: 'files'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'file_versions_file_id_fkey'
            columns: ['file_id']
            isOneToOne: false
            referencedRelation: 'parts_with_pricing'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'file_versions_workflow_state_id_fkey'
            columns: ['workflow_state_id']
            isOneToOne: false
            referencedRelation: 'workflow_states'
            referencedColumns: ['id']
          },
        ]
      }
      file_watchers: {
        Row: {
          created_at: string | null
          file_id: string
          id: string
          notify_on_checkin: boolean | null
          notify_on_checkout: boolean | null
          notify_on_review: boolean | null
          notify_on_state_change: boolean | null
          org_id: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          file_id: string
          id?: string
          notify_on_checkin?: boolean | null
          notify_on_checkout?: boolean | null
          notify_on_review?: boolean | null
          notify_on_state_change?: boolean | null
          org_id: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          file_id?: string
          id?: string
          notify_on_checkin?: boolean | null
          notify_on_checkout?: boolean | null
          notify_on_review?: boolean | null
          notify_on_state_change?: boolean | null
          org_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'file_watchers_file_id_fkey'
            columns: ['file_id']
            isOneToOne: false
            referencedRelation: 'files'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'file_watchers_file_id_fkey'
            columns: ['file_id']
            isOneToOne: false
            referencedRelation: 'parts_with_pricing'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'file_watchers_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'file_watchers_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
        ]
      }
      file_workflow_assignments: {
        Row: {
          assigned_at: string | null
          assigned_by: string | null
          current_state_id: string | null
          file_id: string
          id: string
          workflow_id: string
        }
        Insert: {
          assigned_at?: string | null
          assigned_by?: string | null
          current_state_id?: string | null
          file_id: string
          id?: string
          workflow_id: string
        }
        Update: {
          assigned_at?: string | null
          assigned_by?: string | null
          current_state_id?: string | null
          file_id?: string
          id?: string
          workflow_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'file_workflow_assignments_assigned_by_fkey'
            columns: ['assigned_by']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'file_workflow_assignments_current_state_id_fkey'
            columns: ['current_state_id']
            isOneToOne: false
            referencedRelation: 'workflow_states'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'file_workflow_assignments_file_id_fkey'
            columns: ['file_id']
            isOneToOne: true
            referencedRelation: 'files'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'file_workflow_assignments_file_id_fkey'
            columns: ['file_id']
            isOneToOne: true
            referencedRelation: 'parts_with_pricing'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'file_workflow_assignments_workflow_id_fkey'
            columns: ['workflow_id']
            isOneToOne: false
            referencedRelation: 'workflow_templates'
            referencedColumns: ['id']
          },
        ]
      }
      files: {
        Row: {
          checked_out_at: string | null
          checked_out_by: string | null
          checked_out_by_machine_id: string | null
          checked_out_by_machine_name: string | null
          configuration_revisions: Json | null
          content_hash: string | null
          created_at: string | null
          created_by: string
          custom_properties: Json | null
          deleted_at: string | null
          deleted_by: string | null
          description: string | null
          eco_tags: string[] | null
          extension: string
          file_name: string
          file_path: string
          file_size: number | null
          file_type: Database['public']['Enums']['file_type']
          id: string
          inspection_hash: string | null
          lock_message: string | null
          org_id: string
          part_number: string | null
          revision: string
          state: string | null
          state_changed_at: string | null
          state_changed_by: string | null
          updated_at: string | null
          updated_by: string | null
          vault_id: string | null
          version: number
          workflow_state_id: string | null
        }
        Insert: {
          checked_out_at?: string | null
          checked_out_by?: string | null
          checked_out_by_machine_id?: string | null
          checked_out_by_machine_name?: string | null
          configuration_revisions?: Json | null
          content_hash?: string | null
          created_at?: string | null
          created_by: string
          custom_properties?: Json | null
          deleted_at?: string | null
          deleted_by?: string | null
          description?: string | null
          eco_tags?: string[] | null
          extension: string
          file_name: string
          file_path: string
          file_size?: number | null
          file_type?: Database['public']['Enums']['file_type']
          id?: string
          inspection_hash?: string | null
          lock_message?: string | null
          org_id: string
          part_number?: string | null
          revision?: string
          state?: string | null
          state_changed_at?: string | null
          state_changed_by?: string | null
          updated_at?: string | null
          updated_by?: string | null
          vault_id?: string | null
          version?: number
          workflow_state_id?: string | null
        }
        Update: {
          checked_out_at?: string | null
          checked_out_by?: string | null
          checked_out_by_machine_id?: string | null
          checked_out_by_machine_name?: string | null
          configuration_revisions?: Json | null
          content_hash?: string | null
          created_at?: string | null
          created_by?: string
          custom_properties?: Json | null
          deleted_at?: string | null
          deleted_by?: string | null
          description?: string | null
          eco_tags?: string[] | null
          extension?: string
          file_name?: string
          file_path?: string
          file_size?: number | null
          file_type?: Database['public']['Enums']['file_type']
          id?: string
          inspection_hash?: string | null
          lock_message?: string | null
          org_id?: string
          part_number?: string | null
          revision?: string
          state?: string | null
          state_changed_at?: string | null
          state_changed_by?: string | null
          updated_at?: string | null
          updated_by?: string | null
          vault_id?: string | null
          version?: number
          workflow_state_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'files_checked_out_by_fkey'
            columns: ['checked_out_by']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'files_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'files_deleted_by_fkey'
            columns: ['deleted_by']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'files_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'files_state_changed_by_fkey'
            columns: ['state_changed_by']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'files_updated_by_fkey'
            columns: ['updated_by']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'files_vault_id_fkey'
            columns: ['vault_id']
            isOneToOne: false
            referencedRelation: 'vaults'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'files_workflow_state_id_fkey'
            columns: ['workflow_state_id']
            isOneToOne: false
            referencedRelation: 'workflow_states'
            referencedColumns: ['id']
          },
        ]
      }
      folders: {
        Row: {
          created_at: string | null
          created_by: string | null
          deleted_at: string | null
          deleted_by: string | null
          folder_path: string
          id: string
          org_id: string
          vault_id: string
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          folder_path: string
          id?: string
          org_id: string
          vault_id: string
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          folder_path?: string
          id?: string
          org_id?: string
          vault_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'folders_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'folders_deleted_by_fkey'
            columns: ['deleted_by']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'folders_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'folders_vault_id_fkey'
            columns: ['vault_id']
            isOneToOne: false
            referencedRelation: 'vaults'
            referencedColumns: ['id']
          },
        ]
      }
      inspection_methods: {
        Row: {
          created_at: string | null
          created_by: string | null
          id: string
          name: string
          org_id: string
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          id?: string
          name: string
          org_id: string
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          id?: string
          name?: string
          org_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'inspection_methods_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'inspection_methods_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
        ]
      }
      inspection_characteristic_versions: {
        Row: {
          aql: string | null
          balloon_number: string | null
          char_id: string | null
          char_type: string | null
          classification: string | null
          comments: string | null
          created_at: string | null
          file_version_id: string
          id: string
          internal_inspection_rate: number | null
          inspection_method: string | null
          lower_limit: string | null
          minus_tolerance: string | null
          nominal_value: string | null
          operation: string | null
          org_id: string
          plus_tolerance: string | null
          reference: string | null
          sample_size: number | null
          sort_order: number
          sub_type: string | null
          supplier_inspection_rate: number | null
          unit: string | null
          upper_limit: string | null
          zone: string | null
        }
        Insert: {
          aql?: string | null
          balloon_number?: string | null
          char_id?: string | null
          char_type?: string | null
          classification?: string | null
          comments?: string | null
          created_at?: string | null
          file_version_id: string
          id?: string
          internal_inspection_rate?: number | null
          inspection_method?: string | null
          lower_limit?: string | null
          minus_tolerance?: string | null
          nominal_value?: string | null
          operation?: string | null
          org_id: string
          plus_tolerance?: string | null
          reference?: string | null
          sample_size?: number | null
          sort_order?: number
          sub_type?: string | null
          supplier_inspection_rate?: number | null
          unit?: string | null
          upper_limit?: string | null
          zone?: string | null
        }
        Update: {
          aql?: string | null
          balloon_number?: string | null
          char_id?: string | null
          char_type?: string | null
          classification?: string | null
          comments?: string | null
          created_at?: string | null
          file_version_id?: string
          id?: string
          internal_inspection_rate?: number | null
          inspection_method?: string | null
          lower_limit?: string | null
          minus_tolerance?: string | null
          nominal_value?: string | null
          operation?: string | null
          org_id?: string
          plus_tolerance?: string | null
          reference?: string | null
          sample_size?: number | null
          sort_order?: number
          sub_type?: string | null
          supplier_inspection_rate?: number | null
          unit?: string | null
          upper_limit?: string | null
          zone?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'inspection_characteristic_versions_file_version_id_fkey'
            columns: ['file_version_id']
            isOneToOne: false
            referencedRelation: 'file_versions'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'inspection_characteristic_versions_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
        ]
      }
      inspection_characteristics: {
        Row: {
          aql: string | null
          balloon_number: string | null
          char_id: string | null
          char_type: string | null
          classification: string | null
          comments: string | null
          created_at: string | null
          created_by: string | null
          file_id: string
          id: string
          internal_inspection_rate: number | null
          inspection_method: string | null
          lower_limit: string | null
          minus_tolerance: string | null
          nominal_value: string | null
          operation: string | null
          org_id: string
          plus_tolerance: string | null
          reference: string | null
          sample_size: number | null
          sort_order: number
          sub_type: string | null
          supplier_inspection_rate: number | null
          unit: string | null
          updated_at: string | null
          updated_by: string | null
          upper_limit: string | null
          zone: string | null
        }
        Insert: {
          aql?: string | null
          balloon_number?: string | null
          char_id?: string | null
          char_type?: string | null
          classification?: string | null
          comments?: string | null
          created_at?: string | null
          created_by?: string | null
          file_id: string
          id?: string
          internal_inspection_rate?: number | null
          inspection_method?: string | null
          lower_limit?: string | null
          minus_tolerance?: string | null
          nominal_value?: string | null
          operation?: string | null
          org_id: string
          plus_tolerance?: string | null
          reference?: string | null
          sample_size?: number | null
          sort_order?: number
          sub_type?: string | null
          supplier_inspection_rate?: number | null
          unit?: string | null
          updated_at?: string | null
          updated_by?: string | null
          upper_limit?: string | null
          zone?: string | null
        }
        Update: {
          aql?: string | null
          balloon_number?: string | null
          char_id?: string | null
          char_type?: string | null
          classification?: string | null
          comments?: string | null
          created_at?: string | null
          created_by?: string | null
          file_id?: string
          id?: string
          internal_inspection_rate?: number | null
          inspection_method?: string | null
          lower_limit?: string | null
          minus_tolerance?: string | null
          nominal_value?: string | null
          operation?: string | null
          org_id?: string
          plus_tolerance?: string | null
          reference?: string | null
          sample_size?: number | null
          sort_order?: number
          sub_type?: string | null
          supplier_inspection_rate?: number | null
          unit?: string | null
          updated_at?: string | null
          updated_by?: string | null
          upper_limit?: string | null
          zone?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'inspection_characteristics_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'inspection_characteristics_file_id_fkey'
            columns: ['file_id']
            isOneToOne: false
            referencedRelation: 'files'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'inspection_characteristics_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'inspection_characteristics_updated_by_fkey'
            columns: ['updated_by']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
        ]
      }
      integration_sync_log: {
        Row: {
          completed_at: string | null
          error_details: Json | null
          error_message: string | null
          id: string
          integration_id: string
          org_id: string
          records_created: number | null
          records_errored: number | null
          records_processed: number | null
          records_skipped: number | null
          records_updated: number | null
          started_at: string | null
          status: string
          sync_direction: string
          sync_type: string
          trigger_type: string | null
          triggered_by: string | null
        }
        Insert: {
          completed_at?: string | null
          error_details?: Json | null
          error_message?: string | null
          id?: string
          integration_id: string
          org_id: string
          records_created?: number | null
          records_errored?: number | null
          records_processed?: number | null
          records_skipped?: number | null
          records_updated?: number | null
          started_at?: string | null
          status: string
          sync_direction?: string
          sync_type: string
          trigger_type?: string | null
          triggered_by?: string | null
        }
        Update: {
          completed_at?: string | null
          error_details?: Json | null
          error_message?: string | null
          id?: string
          integration_id?: string
          org_id?: string
          records_created?: number | null
          records_errored?: number | null
          records_processed?: number | null
          records_skipped?: number | null
          records_updated?: number | null
          started_at?: string | null
          status?: string
          sync_direction?: string
          sync_type?: string
          trigger_type?: string | null
          triggered_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'integration_sync_log_integration_id_fkey'
            columns: ['integration_id']
            isOneToOne: false
            referencedRelation: 'organization_integrations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'integration_sync_log_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'integration_sync_log_triggered_by_fkey'
            columns: ['triggered_by']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
        ]
      }
      job_titles: {
        Row: {
          color: string | null
          created_at: string | null
          created_by: string | null
          description: string | null
          icon: string | null
          id: string
          is_system: boolean | null
          name: string
          org_id: string
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          color?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          icon?: string | null
          id?: string
          is_system?: boolean | null
          name: string
          org_id: string
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          color?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          icon?: string | null
          id?: string
          is_system?: boolean | null
          name?: string
          org_id?: string
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'job_titles_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'job_titles_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'job_titles_updated_by_fkey'
            columns: ['updated_by']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
        ]
      }
      notifications: {
        Row: {
          action_completed: boolean | null
          action_completed_at: string | null
          action_type: string | null
          action_url: string | null
          category: string | null
          created_at: string | null
          entity_id: string | null
          entity_type: string | null
          expires_at: string | null
          from_user_id: string | null
          id: string
          message: string | null
          org_id: string
          priority: string | null
          read: boolean | null
          read_at: string | null
          title: string
          type: string
          user_id: string
        }
        Insert: {
          action_completed?: boolean | null
          action_completed_at?: string | null
          action_type?: string | null
          action_url?: string | null
          category?: string | null
          created_at?: string | null
          entity_id?: string | null
          entity_type?: string | null
          expires_at?: string | null
          from_user_id?: string | null
          id?: string
          message?: string | null
          org_id: string
          priority?: string | null
          read?: boolean | null
          read_at?: string | null
          title: string
          type: string
          user_id: string
        }
        Update: {
          action_completed?: boolean | null
          action_completed_at?: string | null
          action_type?: string | null
          action_url?: string | null
          category?: string | null
          created_at?: string | null
          entity_id?: string | null
          entity_type?: string | null
          expires_at?: string | null
          from_user_id?: string | null
          id?: string
          message?: string | null
          org_id?: string
          priority?: string | null
          read?: boolean | null
          read_at?: string | null
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'notifications_from_user_id_fkey'
            columns: ['from_user_id']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'notifications_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'notifications_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
        ]
      }
      odoo_saved_configs: {
        Row: {
          api_key_encrypted: string | null
          color: string | null
          created_at: string | null
          created_by: string | null
          database: string
          description: string | null
          id: string
          is_active: boolean | null
          last_test_error: string | null
          last_test_success: boolean | null
          last_tested_at: string | null
          name: string
          org_id: string
          updated_at: string | null
          updated_by: string | null
          url: string
          username: string
        }
        Insert: {
          api_key_encrypted?: string | null
          color?: string | null
          created_at?: string | null
          created_by?: string | null
          database: string
          description?: string | null
          id?: string
          is_active?: boolean | null
          last_test_error?: string | null
          last_test_success?: boolean | null
          last_tested_at?: string | null
          name: string
          org_id: string
          updated_at?: string | null
          updated_by?: string | null
          url: string
          username: string
        }
        Update: {
          api_key_encrypted?: string | null
          color?: string | null
          created_at?: string | null
          created_by?: string | null
          database?: string
          description?: string | null
          id?: string
          is_active?: boolean | null
          last_test_error?: string | null
          last_test_success?: boolean | null
          last_tested_at?: string | null
          name?: string
          org_id?: string
          updated_at?: string | null
          updated_by?: string | null
          url?: string
          username?: string
        }
        Relationships: [
          {
            foreignKeyName: 'odoo_saved_configs_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'odoo_saved_configs_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'odoo_saved_configs_updated_by_fkey'
            columns: ['updated_by']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
        ]
      }
      organization_addresses: {
        Row: {
          address_line1: string
          address_line2: string | null
          address_type: Database['public']['Enums']['address_type']
          attention_to: string | null
          city: string
          company_name: string | null
          contact_name: string | null
          country: string | null
          created_at: string | null
          id: string
          is_default: boolean | null
          label: string
          org_id: string
          phone: string | null
          postal_code: string | null
          state: string | null
          updated_at: string | null
        }
        Insert: {
          address_line1: string
          address_line2?: string | null
          address_type: Database['public']['Enums']['address_type']
          attention_to?: string | null
          city: string
          company_name?: string | null
          contact_name?: string | null
          country?: string | null
          created_at?: string | null
          id?: string
          is_default?: boolean | null
          label: string
          org_id: string
          phone?: string | null
          postal_code?: string | null
          state?: string | null
          updated_at?: string | null
        }
        Update: {
          address_line1?: string
          address_line2?: string | null
          address_type?: Database['public']['Enums']['address_type']
          attention_to?: string | null
          city?: string
          company_name?: string | null
          contact_name?: string | null
          country?: string | null
          created_at?: string | null
          id?: string
          is_default?: boolean | null
          label?: string
          org_id?: string
          phone?: string | null
          postal_code?: string | null
          state?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'organization_addresses_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
        ]
      }
      organization_integrations: {
        Row: {
          auto_sync: boolean | null
          created_at: string | null
          created_by: string | null
          credentials_encrypted: string | null
          id: string
          integration_type: string
          is_active: boolean | null
          is_connected: boolean | null
          last_connected_at: string | null
          last_error: string | null
          last_sync_at: string | null
          last_sync_count: number | null
          last_sync_message: string | null
          last_sync_status: string | null
          org_id: string
          settings: Json
          sync_interval_minutes: number | null
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          auto_sync?: boolean | null
          created_at?: string | null
          created_by?: string | null
          credentials_encrypted?: string | null
          id?: string
          integration_type: string
          is_active?: boolean | null
          is_connected?: boolean | null
          last_connected_at?: string | null
          last_error?: string | null
          last_sync_at?: string | null
          last_sync_count?: number | null
          last_sync_message?: string | null
          last_sync_status?: string | null
          org_id: string
          settings?: Json
          sync_interval_minutes?: number | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          auto_sync?: boolean | null
          created_at?: string | null
          created_by?: string | null
          credentials_encrypted?: string | null
          id?: string
          integration_type?: string
          is_active?: boolean | null
          is_connected?: boolean | null
          last_connected_at?: string | null
          last_error?: string | null
          last_sync_at?: string | null
          last_sync_count?: number | null
          last_sync_message?: string | null
          last_sync_status?: string | null
          org_id?: string
          settings?: Json
          sync_interval_minutes?: number | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'organization_integrations_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'organization_integrations_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'organization_integrations_updated_by_fkey'
            columns: ['updated_by']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
        ]
      }
      organizations: {
        Row: {
          address_line1: string | null
          address_line2: string | null
          auth_providers: Json | null
          city: string | null
          contact_email: string | null
          country: string | null
          created_at: string | null
          default_new_user_team_id: string | null
          email_domains: string[]
          google_drive_client_id: string | null
          google_drive_client_secret: string | null
          column_defaults_forced_at: string | null
          google_drive_enabled: boolean | null
          google_drive_inspection_template_folder_id: string | null
          id: string
          logo_storage_path: string | null
          logo_url: string | null
          item_definition_settings: Json | null
          module_defaults: Json | null
          module_defaults_forced_at: string | null
          name: string
          phone: string | null
          postal_code: string | null
          revision_scheme: Database['public']['Enums']['revision_scheme'] | null
          rfq_settings: Json | null
          serialization_settings: Json | null
          settings: Json | null
          slug: string
          state: string | null
          website: string | null
        }
        Insert: {
          address_line1?: string | null
          address_line2?: string | null
          auth_providers?: Json | null
          city?: string | null
          contact_email?: string | null
          country?: string | null
          created_at?: string | null
          column_defaults_forced_at?: string | null
          default_new_user_team_id?: string | null
          email_domains?: string[]
          google_drive_client_id?: string | null
          google_drive_client_secret?: string | null
          google_drive_enabled?: boolean | null
          google_drive_inspection_template_folder_id?: string | null
          id?: string
          item_definition_settings?: Json | null
          logo_storage_path?: string | null
          logo_url?: string | null
          module_defaults?: Json | null
          module_defaults_forced_at?: string | null
          name: string
          phone?: string | null
          postal_code?: string | null
          revision_scheme?: Database['public']['Enums']['revision_scheme'] | null
          rfq_settings?: Json | null
          serialization_settings?: Json | null
          settings?: Json | null
          slug: string
          state?: string | null
          website?: string | null
        }
        Update: {
          address_line1?: string | null
          address_line2?: string | null
          auth_providers?: Json | null
          city?: string | null
          column_defaults_forced_at?: string | null
          contact_email?: string | null
          country?: string | null
          created_at?: string | null
          default_new_user_team_id?: string | null
          email_domains?: string[]
          google_drive_client_id?: string | null
          google_drive_client_secret?: string | null
          google_drive_enabled?: boolean | null
          google_drive_inspection_template_folder_id?: string | null
          id?: string
          item_definition_settings?: Json | null
          logo_storage_path?: string | null
          logo_url?: string | null
          module_defaults?: Json | null
          module_defaults_forced_at?: string | null
          name?: string
          phone?: string | null
          postal_code?: string | null
          revision_scheme?: Database['public']['Enums']['revision_scheme'] | null
          rfq_settings?: Json | null
          serialization_settings?: Json | null
          settings?: Json | null
          slug?: string
          state?: string | null
          website?: string | null
        }
        Relationships: []
      }
      part_suppliers: {
        Row: {
          created_at: string | null
          created_by: string | null
          currency: string | null
          erp_id: string | null
          erp_synced_at: string | null
          file_id: string
          id: string
          is_active: boolean | null
          is_preferred: boolean | null
          is_qualified: boolean | null
          last_price_update: string | null
          lead_time_days: number | null
          min_order_qty: number | null
          notes: string | null
          order_multiple: number | null
          org_id: string
          price_breaks: Json | null
          price_unit: string | null
          qualified_at: string | null
          qualified_by: string | null
          supplier_description: string | null
          supplier_id: string
          supplier_part_number: string | null
          supplier_url: string | null
          unit_price: number | null
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          currency?: string | null
          erp_id?: string | null
          erp_synced_at?: string | null
          file_id: string
          id?: string
          is_active?: boolean | null
          is_preferred?: boolean | null
          is_qualified?: boolean | null
          last_price_update?: string | null
          lead_time_days?: number | null
          min_order_qty?: number | null
          notes?: string | null
          order_multiple?: number | null
          org_id: string
          price_breaks?: Json | null
          price_unit?: string | null
          qualified_at?: string | null
          qualified_by?: string | null
          supplier_description?: string | null
          supplier_id: string
          supplier_part_number?: string | null
          supplier_url?: string | null
          unit_price?: number | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          currency?: string | null
          erp_id?: string | null
          erp_synced_at?: string | null
          file_id?: string
          id?: string
          is_active?: boolean | null
          is_preferred?: boolean | null
          is_qualified?: boolean | null
          last_price_update?: string | null
          lead_time_days?: number | null
          min_order_qty?: number | null
          notes?: string | null
          order_multiple?: number | null
          org_id?: string
          price_breaks?: Json | null
          price_unit?: string | null
          qualified_at?: string | null
          qualified_by?: string | null
          supplier_description?: string | null
          supplier_id?: string
          supplier_part_number?: string | null
          supplier_url?: string | null
          unit_price?: number | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'part_suppliers_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'part_suppliers_file_id_fkey'
            columns: ['file_id']
            isOneToOne: false
            referencedRelation: 'files'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'part_suppliers_file_id_fkey'
            columns: ['file_id']
            isOneToOne: false
            referencedRelation: 'parts_with_pricing'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'part_suppliers_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'part_suppliers_qualified_by_fkey'
            columns: ['qualified_by']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'part_suppliers_supplier_id_fkey'
            columns: ['supplier_id']
            isOneToOne: false
            referencedRelation: 'suppliers'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'part_suppliers_updated_by_fkey'
            columns: ['updated_by']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
        ]
      }
      pending_org_members: {
        Row: {
          claimed_at: string | null
          claimed_by: string | null
          email: string
          expires_at: string | null
          full_name: string | null
          id: string
          invited_at: string | null
          invited_by: string | null
          notes: string | null
          org_id: string
          role: Database['public']['Enums']['user_role'] | null
          solidworks_license_ids: string[] | null
          team_ids: string[] | null
          vault_ids: string[] | null
          workflow_role_ids: string[] | null
        }
        Insert: {
          claimed_at?: string | null
          claimed_by?: string | null
          email: string
          expires_at?: string | null
          full_name?: string | null
          id?: string
          invited_at?: string | null
          invited_by?: string | null
          notes?: string | null
          org_id: string
          role?: Database['public']['Enums']['user_role'] | null
          solidworks_license_ids?: string[] | null
          team_ids?: string[] | null
          vault_ids?: string[] | null
          workflow_role_ids?: string[] | null
        }
        Update: {
          claimed_at?: string | null
          claimed_by?: string | null
          email?: string
          expires_at?: string | null
          full_name?: string | null
          id?: string
          invited_at?: string | null
          invited_by?: string | null
          notes?: string | null
          org_id?: string
          role?: Database['public']['Enums']['user_role'] | null
          solidworks_license_ids?: string[] | null
          team_ids?: string[] | null
          vault_ids?: string[] | null
          workflow_role_ids?: string[] | null
        }
        Relationships: [
          {
            foreignKeyName: 'pending_org_members_claimed_by_fkey'
            columns: ['claimed_by']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'pending_org_members_invited_by_fkey'
            columns: ['invited_by']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'pending_org_members_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
        ]
      }
      pending_reviews: {
        Row: {
          assigned_to: string | null
          checklist_responses: Json | null
          created_at: string | null
          expires_at: string | null
          file_id: string
          gate_id: string
          id: string
          org_id: string
          requested_at: string | null
          requested_by: string
          review_comment: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: Database['public']['Enums']['review_status']
          transition_id: string
        }
        Insert: {
          assigned_to?: string | null
          checklist_responses?: Json | null
          created_at?: string | null
          expires_at?: string | null
          file_id: string
          gate_id: string
          id?: string
          org_id: string
          requested_at?: string | null
          requested_by: string
          review_comment?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database['public']['Enums']['review_status']
          transition_id: string
        }
        Update: {
          assigned_to?: string | null
          checklist_responses?: Json | null
          created_at?: string | null
          expires_at?: string | null
          file_id?: string
          gate_id?: string
          id?: string
          org_id?: string
          requested_at?: string | null
          requested_by?: string
          review_comment?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database['public']['Enums']['review_status']
          transition_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'pending_reviews_assigned_to_fkey'
            columns: ['assigned_to']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'pending_reviews_file_id_fkey'
            columns: ['file_id']
            isOneToOne: false
            referencedRelation: 'files'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'pending_reviews_file_id_fkey'
            columns: ['file_id']
            isOneToOne: false
            referencedRelation: 'parts_with_pricing'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'pending_reviews_gate_id_fkey'
            columns: ['gate_id']
            isOneToOne: false
            referencedRelation: 'workflow_gates'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'pending_reviews_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'pending_reviews_requested_by_fkey'
            columns: ['requested_by']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'pending_reviews_reviewed_by_fkey'
            columns: ['reviewed_by']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'pending_reviews_transition_id_fkey'
            columns: ['transition_id']
            isOneToOne: false
            referencedRelation: 'workflow_transitions'
            referencedColumns: ['id']
          },
        ]
      }
      pending_transition_approvals: {
        Row: {
          approval_id: string
          created_at: string | null
          expires_at: string | null
          file_id: string
          id: string
          org_id: string
          requested_at: string | null
          requested_by: string
          status: Database['public']['Enums']['review_status'] | null
          transition_id: string
        }
        Insert: {
          approval_id: string
          created_at?: string | null
          expires_at?: string | null
          file_id: string
          id?: string
          org_id: string
          requested_at?: string | null
          requested_by: string
          status?: Database['public']['Enums']['review_status'] | null
          transition_id: string
        }
        Update: {
          approval_id?: string
          created_at?: string | null
          expires_at?: string | null
          file_id?: string
          id?: string
          org_id?: string
          requested_at?: string | null
          requested_by?: string
          status?: Database['public']['Enums']['review_status'] | null
          transition_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'pending_transition_approvals_approval_id_fkey'
            columns: ['approval_id']
            isOneToOne: false
            referencedRelation: 'workflow_transition_approvals'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'pending_transition_approvals_file_id_fkey'
            columns: ['file_id']
            isOneToOne: false
            referencedRelation: 'files'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'pending_transition_approvals_file_id_fkey'
            columns: ['file_id']
            isOneToOne: false
            referencedRelation: 'parts_with_pricing'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'pending_transition_approvals_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'pending_transition_approvals_requested_by_fkey'
            columns: ['requested_by']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'pending_transition_approvals_transition_id_fkey'
            columns: ['transition_id']
            isOneToOne: false
            referencedRelation: 'workflow_transitions'
            referencedColumns: ['id']
          },
        ]
      }
      permission_presets: {
        Row: {
          color: string | null
          created_at: string | null
          created_by: string | null
          description: string | null
          icon: string | null
          id: string
          is_system: boolean | null
          name: string
          org_id: string
          permissions: Json | null
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          color?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          icon?: string | null
          id?: string
          is_system?: boolean | null
          name: string
          org_id: string
          permissions?: Json | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          color?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          icon?: string | null
          id?: string
          is_system?: boolean | null
          name?: string
          org_id?: string
          permissions?: Json | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'permission_presets_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'permission_presets_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'permission_presets_updated_by_fkey'
            columns: ['updated_by']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
        ]
      }
      process_template_items: {
        Row: {
          created_at: string | null
          default_accountable: string | null
          default_consulted: string | null
          default_duration_days: number | null
          default_informed: string | null
          default_offset_days: number | null
          default_responsible: string | null
          description: string | null
          doc_number: string | null
          id: string
          name: string
          phase_id: string
          required_for_gate: boolean | null
          sort_order: number
          uid: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          default_accountable?: string | null
          default_consulted?: string | null
          default_duration_days?: number | null
          default_informed?: string | null
          default_offset_days?: number | null
          default_responsible?: string | null
          description?: string | null
          doc_number?: string | null
          id?: string
          name: string
          phase_id: string
          required_for_gate?: boolean | null
          sort_order?: number
          uid?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          default_accountable?: string | null
          default_consulted?: string | null
          default_duration_days?: number | null
          default_informed?: string | null
          default_offset_days?: number | null
          default_responsible?: string | null
          description?: string | null
          doc_number?: string | null
          id?: string
          name?: string
          phase_id?: string
          required_for_gate?: boolean | null
          sort_order?: number
          uid?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'process_template_items_phase_id_fkey'
            columns: ['phase_id']
            isOneToOne: false
            referencedRelation: 'process_template_phases'
            referencedColumns: ['id']
          },
        ]
      }
      process_template_phases: {
        Row: {
          created_at: string | null
          description: string | null
          gate_description: string | null
          gate_name: string | null
          id: string
          name: string
          sort_order: number
          template_id: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          gate_description?: string | null
          gate_name?: string | null
          id?: string
          name: string
          sort_order?: number
          template_id: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          gate_description?: string | null
          gate_name?: string | null
          id?: string
          name?: string
          sort_order?: number
          template_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'process_template_phases_template_id_fkey'
            columns: ['template_id']
            isOneToOne: false
            referencedRelation: 'process_templates'
            referencedColumns: ['id']
          },
        ]
      }
      process_templates: {
        Row: {
          created_at: string | null
          created_by: string | null
          description: string | null
          id: string
          is_active: boolean | null
          is_default: boolean | null
          name: string
          org_id: string
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          is_default?: boolean | null
          name: string
          org_id: string
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          is_default?: boolean | null
          name?: string
          org_id?: string
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'process_templates_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'process_templates_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'process_templates_updated_by_fkey'
            columns: ['updated_by']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
        ]
      }
      release_files: {
        Row: {
          created_at: string | null
          file_id: string
          file_name: string
          file_size: number | null
          file_type: Database['public']['Enums']['release_file_type']
          file_version_id: string | null
          generated_at: string | null
          generated_by: string | null
          id: string
          local_path: string | null
          org_id: string
          revision: string | null
          rfq_id: string | null
          rfq_item_id: string | null
          storage_hash: string | null
          storage_path: string | null
          updated_at: string | null
          version: number
        }
        Insert: {
          created_at?: string | null
          file_id: string
          file_name: string
          file_size?: number | null
          file_type: Database['public']['Enums']['release_file_type']
          file_version_id?: string | null
          generated_at?: string | null
          generated_by?: string | null
          id?: string
          local_path?: string | null
          org_id: string
          revision?: string | null
          rfq_id?: string | null
          rfq_item_id?: string | null
          storage_hash?: string | null
          storage_path?: string | null
          updated_at?: string | null
          version: number
        }
        Update: {
          created_at?: string | null
          file_id?: string
          file_name?: string
          file_size?: number | null
          file_type?: Database['public']['Enums']['release_file_type']
          file_version_id?: string | null
          generated_at?: string | null
          generated_by?: string | null
          id?: string
          local_path?: string | null
          org_id?: string
          revision?: string | null
          rfq_id?: string | null
          rfq_item_id?: string | null
          storage_hash?: string | null
          storage_path?: string | null
          updated_at?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: 'release_files_file_id_fkey'
            columns: ['file_id']
            isOneToOne: false
            referencedRelation: 'files'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'release_files_file_id_fkey'
            columns: ['file_id']
            isOneToOne: false
            referencedRelation: 'parts_with_pricing'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'release_files_file_version_id_fkey'
            columns: ['file_version_id']
            isOneToOne: false
            referencedRelation: 'file_versions'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'release_files_generated_by_fkey'
            columns: ['generated_by']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'release_files_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
        ]
      }
      review_history: {
        Row: {
          checklist_responses: Json | null
          comment: string | null
          created_at: string | null
          decision: string
          file_id: string | null
          file_name: string
          file_path: string
          from_state_name: string
          gate_id: string | null
          gate_name: string
          id: string
          org_id: string
          requested_at: string
          requested_by: string | null
          requested_by_email: string
          reviewed_at: string
          reviewed_by: string | null
          reviewed_by_email: string
          to_state_name: string
          transition_id: string | null
          workflow_id: string | null
          workflow_name: string
        }
        Insert: {
          checklist_responses?: Json | null
          comment?: string | null
          created_at?: string | null
          decision: string
          file_id?: string | null
          file_name: string
          file_path: string
          from_state_name: string
          gate_id?: string | null
          gate_name: string
          id?: string
          org_id: string
          requested_at: string
          requested_by?: string | null
          requested_by_email: string
          reviewed_at: string
          reviewed_by?: string | null
          reviewed_by_email: string
          to_state_name: string
          transition_id?: string | null
          workflow_id?: string | null
          workflow_name: string
        }
        Update: {
          checklist_responses?: Json | null
          comment?: string | null
          created_at?: string | null
          decision?: string
          file_id?: string | null
          file_name?: string
          file_path?: string
          from_state_name?: string
          gate_id?: string | null
          gate_name?: string
          id?: string
          org_id?: string
          requested_at?: string
          requested_by?: string | null
          requested_by_email?: string
          reviewed_at?: string
          reviewed_by?: string | null
          reviewed_by_email?: string
          to_state_name?: string
          transition_id?: string | null
          workflow_id?: string | null
          workflow_name?: string
        }
        Relationships: []
      }
      review_responses: {
        Row: {
          comment: string | null
          created_at: string | null
          id: string
          responded_at: string | null
          review_id: string
          reviewer_id: string
          status: Database['public']['Enums']['review_status'] | null
          updated_at: string | null
        }
        Insert: {
          comment?: string | null
          created_at?: string | null
          id?: string
          responded_at?: string | null
          review_id: string
          reviewer_id: string
          status?: Database['public']['Enums']['review_status'] | null
          updated_at?: string | null
        }
        Update: {
          comment?: string | null
          created_at?: string | null
          id?: string
          responded_at?: string | null
          review_id?: string
          reviewer_id?: string
          status?: Database['public']['Enums']['review_status'] | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'review_responses_review_id_fkey'
            columns: ['review_id']
            isOneToOne: false
            referencedRelation: 'reviews'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'review_responses_reviewer_id_fkey'
            columns: ['reviewer_id']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
        ]
      }
      reviews: {
        Row: {
          completed_at: string | null
          created_at: string | null
          due_date: string | null
          file_id: string
          file_version: number
          id: string
          message: string | null
          org_id: string
          priority: string | null
          requested_at: string | null
          requested_by: string
          status: Database['public']['Enums']['review_status']
          title: string | null
          updated_at: string | null
          vault_id: string | null
        }
        Insert: {
          completed_at?: string | null
          created_at?: string | null
          due_date?: string | null
          file_id: string
          file_version: number
          id?: string
          message?: string | null
          org_id: string
          priority?: string | null
          requested_at?: string | null
          requested_by: string
          status?: Database['public']['Enums']['review_status']
          title?: string | null
          updated_at?: string | null
          vault_id?: string | null
        }
        Update: {
          completed_at?: string | null
          created_at?: string | null
          due_date?: string | null
          file_id?: string
          file_version?: number
          id?: string
          message?: string | null
          org_id?: string
          priority?: string | null
          requested_at?: string | null
          requested_by?: string
          status?: Database['public']['Enums']['review_status']
          title?: string | null
          updated_at?: string | null
          vault_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'reviews_file_id_fkey'
            columns: ['file_id']
            isOneToOne: false
            referencedRelation: 'files'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'reviews_file_id_fkey'
            columns: ['file_id']
            isOneToOne: false
            referencedRelation: 'parts_with_pricing'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'reviews_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'reviews_requested_by_fkey'
            columns: ['requested_by']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'reviews_vault_id_fkey'
            columns: ['vault_id']
            isOneToOne: false
            referencedRelation: 'vaults'
            referencedColumns: ['id']
          },
        ]
      }
      revision_schemes: {
        Row: {
          created_at: string | null
          created_by: string | null
          custom_pattern: string | null
          description: string | null
          id: string
          increment_by: number | null
          is_active: boolean | null
          is_default: boolean | null
          major_minor_separator: string | null
          minor_scheme_type: Database['public']['Enums']['revision_scheme_type'] | null
          name: string
          org_id: string
          prefix: string | null
          scheme_type: Database['public']['Enums']['revision_scheme_type']
          start_value: number | null
          suffix: string | null
          updated_at: string | null
          zero_padding: number | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          custom_pattern?: string | null
          description?: string | null
          id?: string
          increment_by?: number | null
          is_active?: boolean | null
          is_default?: boolean | null
          major_minor_separator?: string | null
          minor_scheme_type?: Database['public']['Enums']['revision_scheme_type'] | null
          name: string
          org_id: string
          prefix?: string | null
          scheme_type?: Database['public']['Enums']['revision_scheme_type']
          start_value?: number | null
          suffix?: string | null
          updated_at?: string | null
          zero_padding?: number | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          custom_pattern?: string | null
          description?: string | null
          id?: string
          increment_by?: number | null
          is_active?: boolean | null
          is_default?: boolean | null
          major_minor_separator?: string | null
          minor_scheme_type?: Database['public']['Enums']['revision_scheme_type'] | null
          name?: string
          org_id?: string
          prefix?: string | null
          scheme_type?: Database['public']['Enums']['revision_scheme_type']
          start_value?: number | null
          suffix?: string | null
          updated_at?: string | null
          zero_padding?: number | null
        }
        Relationships: [
          {
            foreignKeyName: 'revision_schemes_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'revision_schemes_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
        ]
      }
      rfq_activity: {
        Row: {
          action: string
          details: Json | null
          id: string
          performed_at: string | null
          performed_by: string | null
          rfq_id: string
          supplier_contact_id: string | null
        }
        Insert: {
          action: string
          details?: Json | null
          id?: string
          performed_at?: string | null
          performed_by?: string | null
          rfq_id: string
          supplier_contact_id?: string | null
        }
        Update: {
          action?: string
          details?: Json | null
          id?: string
          performed_at?: string | null
          performed_by?: string | null
          rfq_id?: string
          supplier_contact_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'rfq_activity_performed_by_fkey'
            columns: ['performed_by']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'rfq_activity_rfq_id_fkey'
            columns: ['rfq_id']
            isOneToOne: false
            referencedRelation: 'rfqs'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'rfq_activity_supplier_contact_id_fkey'
            columns: ['supplier_contact_id']
            isOneToOne: false
            referencedRelation: 'supplier_contacts'
            referencedColumns: ['id']
          },
        ]
      }
      rfq_items: {
        Row: {
          created_at: string | null
          description: string | null
          file_id: string | null
          finish: string | null
          id: string
          line_number: number
          material: string | null
          notes: string | null
          part_number: string | null
          quantity: number
          release_files_error: string | null
          release_files_status: string | null
          revision: string | null
          rfq_id: string
          sort_order: number | null
          uom: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          file_id?: string | null
          finish?: string | null
          id?: string
          line_number: number
          material?: string | null
          notes?: string | null
          part_number?: string | null
          quantity?: number
          release_files_error?: string | null
          release_files_status?: string | null
          revision?: string | null
          rfq_id: string
          sort_order?: number | null
          uom?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          file_id?: string | null
          finish?: string | null
          id?: string
          line_number?: number
          material?: string | null
          notes?: string | null
          part_number?: string | null
          quantity?: number
          release_files_error?: string | null
          release_files_status?: string | null
          revision?: string | null
          rfq_id?: string
          sort_order?: number | null
          uom?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'rfq_items_file_id_fkey'
            columns: ['file_id']
            isOneToOne: false
            referencedRelation: 'files'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'rfq_items_file_id_fkey'
            columns: ['file_id']
            isOneToOne: false
            referencedRelation: 'parts_with_pricing'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'rfq_items_rfq_id_fkey'
            columns: ['rfq_id']
            isOneToOne: false
            referencedRelation: 'rfqs'
            referencedColumns: ['id']
          },
        ]
      }
      rfq_quotes: {
        Row: {
          created_at: string | null
          currency: string | null
          id: string
          is_selected: boolean | null
          lead_time_days: number | null
          min_order_qty: number | null
          notes: string | null
          rfq_id: string
          rfq_item_id: string
          supplier_id: string
          unit_price: number | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          currency?: string | null
          id?: string
          is_selected?: boolean | null
          lead_time_days?: number | null
          min_order_qty?: number | null
          notes?: string | null
          rfq_id: string
          rfq_item_id: string
          supplier_id: string
          unit_price?: number | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          currency?: string | null
          id?: string
          is_selected?: boolean | null
          lead_time_days?: number | null
          min_order_qty?: number | null
          notes?: string | null
          rfq_id?: string
          rfq_item_id?: string
          supplier_id?: string
          unit_price?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'rfq_quotes_rfq_id_fkey'
            columns: ['rfq_id']
            isOneToOne: false
            referencedRelation: 'rfqs'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'rfq_quotes_rfq_item_id_fkey'
            columns: ['rfq_item_id']
            isOneToOne: false
            referencedRelation: 'rfq_items'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'rfq_quotes_supplier_id_fkey'
            columns: ['supplier_id']
            isOneToOne: false
            referencedRelation: 'suppliers'
            referencedColumns: ['id']
          },
        ]
      }
      rfq_suppliers: {
        Row: {
          contact_email: string | null
          contact_id: string | null
          created_at: string | null
          id: string
          responded_at: string | null
          response_status: string | null
          rfq_id: string
          sent_at: string | null
          sent_by: string | null
          sent_via: string | null
          supplier_id: string
          viewed_at: string | null
        }
        Insert: {
          contact_email?: string | null
          contact_id?: string | null
          created_at?: string | null
          id?: string
          responded_at?: string | null
          response_status?: string | null
          rfq_id: string
          sent_at?: string | null
          sent_by?: string | null
          sent_via?: string | null
          supplier_id: string
          viewed_at?: string | null
        }
        Update: {
          contact_email?: string | null
          contact_id?: string | null
          created_at?: string | null
          id?: string
          responded_at?: string | null
          response_status?: string | null
          rfq_id?: string
          sent_at?: string | null
          sent_by?: string | null
          sent_via?: string | null
          supplier_id?: string
          viewed_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'rfq_suppliers_contact_id_fkey'
            columns: ['contact_id']
            isOneToOne: false
            referencedRelation: 'supplier_contacts'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'rfq_suppliers_rfq_id_fkey'
            columns: ['rfq_id']
            isOneToOne: false
            referencedRelation: 'rfqs'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'rfq_suppliers_sent_by_fkey'
            columns: ['sent_by']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'rfq_suppliers_supplier_id_fkey'
            columns: ['supplier_id']
            isOneToOne: false
            referencedRelation: 'suppliers'
            referencedColumns: ['id']
          },
        ]
      }
      rfqs: {
        Row: {
          allow_partial_quotes: boolean | null
          award_notes: string | null
          awarded_at: string | null
          awarded_by: string | null
          awarded_supplier_id: string | null
          billing_address_id: string | null
          created_at: string | null
          created_by: string | null
          description: string | null
          due_date: string | null
          id: string
          incoterms: string | null
          internal_notes: string | null
          org_id: string
          pdf_generated_at: string | null
          pdf_url: string | null
          release_files_generated: boolean | null
          release_files_generated_at: string | null
          release_folder_path: string | null
          required_date: string | null
          requires_first_article: boolean | null
          requires_quality_report: boolean | null
          requires_samples: boolean | null
          rfq_number: string
          shipping_address: string | null
          shipping_address_id: string | null
          shipping_notes: string | null
          status: Database['public']['Enums']['rfq_status']
          supplier_notes: string | null
          title: string
          updated_at: string | null
          updated_by: string | null
          valid_until: string | null
        }
        Insert: {
          allow_partial_quotes?: boolean | null
          award_notes?: string | null
          awarded_at?: string | null
          awarded_by?: string | null
          awarded_supplier_id?: string | null
          billing_address_id?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          due_date?: string | null
          id?: string
          incoterms?: string | null
          internal_notes?: string | null
          org_id: string
          pdf_generated_at?: string | null
          pdf_url?: string | null
          release_files_generated?: boolean | null
          release_files_generated_at?: string | null
          release_folder_path?: string | null
          required_date?: string | null
          requires_first_article?: boolean | null
          requires_quality_report?: boolean | null
          requires_samples?: boolean | null
          rfq_number: string
          shipping_address?: string | null
          shipping_address_id?: string | null
          shipping_notes?: string | null
          status?: Database['public']['Enums']['rfq_status']
          supplier_notes?: string | null
          title: string
          updated_at?: string | null
          updated_by?: string | null
          valid_until?: string | null
        }
        Update: {
          allow_partial_quotes?: boolean | null
          award_notes?: string | null
          awarded_at?: string | null
          awarded_by?: string | null
          awarded_supplier_id?: string | null
          billing_address_id?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          due_date?: string | null
          id?: string
          incoterms?: string | null
          internal_notes?: string | null
          org_id?: string
          pdf_generated_at?: string | null
          pdf_url?: string | null
          release_files_generated?: boolean | null
          release_files_generated_at?: string | null
          release_folder_path?: string | null
          required_date?: string | null
          requires_first_article?: boolean | null
          requires_quality_report?: boolean | null
          requires_samples?: boolean | null
          rfq_number?: string
          shipping_address?: string | null
          shipping_address_id?: string | null
          shipping_notes?: string | null
          status?: Database['public']['Enums']['rfq_status']
          supplier_notes?: string | null
          title?: string
          updated_at?: string | null
          updated_by?: string | null
          valid_until?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'rfqs_awarded_by_fkey'
            columns: ['awarded_by']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'rfqs_awarded_supplier_id_fkey'
            columns: ['awarded_supplier_id']
            isOneToOne: false
            referencedRelation: 'suppliers'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'rfqs_billing_address_id_fkey'
            columns: ['billing_address_id']
            isOneToOne: false
            referencedRelation: 'organization_addresses'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'rfqs_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'rfqs_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'rfqs_shipping_address_id_fkey'
            columns: ['shipping_address_id']
            isOneToOne: false
            referencedRelation: 'organization_addresses'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'rfqs_updated_by_fkey'
            columns: ['updated_by']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
        ]
      }
      schema_version: {
        Row: {
          applied_at: string | null
          applied_by: string | null
          description: string | null
          id: number
          version: number
        }
        Insert: {
          applied_at?: string | null
          applied_by?: string | null
          description?: string | null
          id?: number
          version?: number
        }
        Update: {
          applied_at?: string | null
          applied_by?: string | null
          description?: string | null
          id?: number
          version?: number
        }
        Relationships: []
      }
      solidworks_license_assignments: {
        Row: {
          activated_at: string | null
          assigned_at: string | null
          assigned_by: string | null
          deactivated_at: string | null
          id: string
          is_active: boolean | null
          license_id: string
          machine_id: string | null
          machine_name: string | null
          user_id: string
        }
        Insert: {
          activated_at?: string | null
          assigned_at?: string | null
          assigned_by?: string | null
          deactivated_at?: string | null
          id?: string
          is_active?: boolean | null
          license_id: string
          machine_id?: string | null
          machine_name?: string | null
          user_id: string
        }
        Update: {
          activated_at?: string | null
          assigned_at?: string | null
          assigned_by?: string | null
          deactivated_at?: string | null
          id?: string
          is_active?: boolean | null
          license_id?: string
          machine_id?: string | null
          machine_name?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'solidworks_license_assignments_assigned_by_fkey'
            columns: ['assigned_by']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'solidworks_license_assignments_license_id_fkey'
            columns: ['license_id']
            isOneToOne: false
            referencedRelation: 'solidworks_licenses'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'solidworks_license_assignments_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
        ]
      }
      solidworks_licenses: {
        Row: {
          created_at: string | null
          created_by: string | null
          expiry_date: string | null
          id: string
          license_type: Database['public']['Enums']['solidworks_license_type'] | null
          nickname: string | null
          notes: string | null
          org_id: string
          product_name: string | null
          purchase_date: string | null
          seats: number | null
          serial_number: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          expiry_date?: string | null
          id?: string
          license_type?: Database['public']['Enums']['solidworks_license_type'] | null
          nickname?: string | null
          notes?: string | null
          org_id: string
          product_name?: string | null
          purchase_date?: string | null
          seats?: number | null
          serial_number: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          expiry_date?: string | null
          id?: string
          license_type?: Database['public']['Enums']['solidworks_license_type'] | null
          nickname?: string | null
          notes?: string | null
          org_id?: string
          product_name?: string | null
          purchase_date?: string | null
          seats?: number | null
          serial_number?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'solidworks_licenses_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'solidworks_licenses_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
        ]
      }
      supplier_contacts: {
        Row: {
          auth_method: Database['public']['Enums']['supplier_auth_method'] | null
          auth_user_id: string | null
          avatar_url: string | null
          can_manage_catalog: boolean | null
          can_submit_quotes: boolean | null
          can_update_pricing: boolean | null
          can_view_orders: boolean | null
          can_view_rfqs: boolean | null
          created_at: string | null
          email: string | null
          email_verified: boolean | null
          full_name: string
          id: string
          is_active: boolean | null
          is_primary: boolean | null
          job_title: string | null
          last_sign_in: string | null
          phone: string | null
          phone_country_code: string | null
          phone_verified: boolean | null
          supplier_id: string
          updated_at: string | null
          wechat_openid: string | null
        }
        Insert: {
          auth_method?: Database['public']['Enums']['supplier_auth_method'] | null
          auth_user_id?: string | null
          avatar_url?: string | null
          can_manage_catalog?: boolean | null
          can_submit_quotes?: boolean | null
          can_update_pricing?: boolean | null
          can_view_orders?: boolean | null
          can_view_rfqs?: boolean | null
          created_at?: string | null
          email?: string | null
          email_verified?: boolean | null
          full_name: string
          id?: string
          is_active?: boolean | null
          is_primary?: boolean | null
          job_title?: string | null
          last_sign_in?: string | null
          phone?: string | null
          phone_country_code?: string | null
          phone_verified?: boolean | null
          supplier_id: string
          updated_at?: string | null
          wechat_openid?: string | null
        }
        Update: {
          auth_method?: Database['public']['Enums']['supplier_auth_method'] | null
          auth_user_id?: string | null
          avatar_url?: string | null
          can_manage_catalog?: boolean | null
          can_submit_quotes?: boolean | null
          can_update_pricing?: boolean | null
          can_view_orders?: boolean | null
          can_view_rfqs?: boolean | null
          created_at?: string | null
          email?: string | null
          email_verified?: boolean | null
          full_name?: string
          id?: string
          is_active?: boolean | null
          is_primary?: boolean | null
          job_title?: string | null
          last_sign_in?: string | null
          phone?: string | null
          phone_country_code?: string | null
          phone_verified?: boolean | null
          supplier_id?: string
          updated_at?: string | null
          wechat_openid?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'supplier_contacts_supplier_id_fkey'
            columns: ['supplier_id']
            isOneToOne: false
            referencedRelation: 'suppliers'
            referencedColumns: ['id']
          },
        ]
      }
      supplier_invitations: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          created_at: string | null
          email: string | null
          expires_at: string
          full_name: string
          id: string
          invited_at: string | null
          invited_by: string | null
          org_id: string
          phone: string | null
          supplier_id: string
          token: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string | null
          email?: string | null
          expires_at: string
          full_name: string
          id?: string
          invited_at?: string | null
          invited_by?: string | null
          org_id: string
          phone?: string | null
          supplier_id: string
          token: string
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string | null
          email?: string | null
          expires_at?: string
          full_name?: string
          id?: string
          invited_at?: string | null
          invited_by?: string | null
          org_id?: string
          phone?: string | null
          supplier_id?: string
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: 'supplier_invitations_invited_by_fkey'
            columns: ['invited_by']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'supplier_invitations_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'supplier_invitations_supplier_id_fkey'
            columns: ['supplier_id']
            isOneToOne: false
            referencedRelation: 'suppliers'
            referencedColumns: ['id']
          },
        ]
      }
      suppliers: {
        Row: {
          address_line1: string | null
          address_line2: string | null
          approved_at: string | null
          approved_by: string | null
          city: string | null
          code: string | null
          contact_email: string | null
          contact_name: string | null
          contact_phone: string | null
          country: string | null
          created_at: string | null
          created_by: string | null
          currency: string | null
          default_lead_time_days: number | null
          erp_id: string | null
          erp_synced_at: string | null
          id: string
          is_active: boolean | null
          is_approved: boolean | null
          min_order_value: number | null
          name: string
          notes: string | null
          org_id: string
          payment_terms: string | null
          postal_code: string | null
          shipping_account: string | null
          state: string | null
          updated_at: string | null
          updated_by: string | null
          website: string | null
        }
        Insert: {
          address_line1?: string | null
          address_line2?: string | null
          approved_at?: string | null
          approved_by?: string | null
          city?: string | null
          code?: string | null
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          country?: string | null
          created_at?: string | null
          created_by?: string | null
          currency?: string | null
          default_lead_time_days?: number | null
          erp_id?: string | null
          erp_synced_at?: string | null
          id?: string
          is_active?: boolean | null
          is_approved?: boolean | null
          min_order_value?: number | null
          name: string
          notes?: string | null
          org_id: string
          payment_terms?: string | null
          postal_code?: string | null
          shipping_account?: string | null
          state?: string | null
          updated_at?: string | null
          updated_by?: string | null
          website?: string | null
        }
        Update: {
          address_line1?: string | null
          address_line2?: string | null
          approved_at?: string | null
          approved_by?: string | null
          city?: string | null
          code?: string | null
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          country?: string | null
          created_at?: string | null
          created_by?: string | null
          currency?: string | null
          default_lead_time_days?: number | null
          erp_id?: string | null
          erp_synced_at?: string | null
          id?: string
          is_active?: boolean | null
          is_approved?: boolean | null
          min_order_value?: number | null
          name?: string
          notes?: string | null
          org_id?: string
          payment_terms?: string | null
          postal_code?: string | null
          shipping_account?: string | null
          state?: string | null
          updated_at?: string | null
          updated_by?: string | null
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'suppliers_approved_by_fkey'
            columns: ['approved_by']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'suppliers_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'suppliers_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'suppliers_updated_by_fkey'
            columns: ['updated_by']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
        ]
      }
      team_members: {
        Row: {
          added_at: string | null
          added_by: string | null
          id: string
          is_team_admin: boolean | null
          team_id: string
          user_id: string
        }
        Insert: {
          added_at?: string | null
          added_by?: string | null
          id?: string
          is_team_admin?: boolean | null
          team_id: string
          user_id: string
        }
        Update: {
          added_at?: string | null
          added_by?: string | null
          id?: string
          is_team_admin?: boolean | null
          team_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'team_members_added_by_fkey'
            columns: ['added_by']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'team_members_team_id_fkey'
            columns: ['team_id']
            isOneToOne: false
            referencedRelation: 'teams'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'team_members_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
        ]
      }
      team_permissions: {
        Row: {
          actions: Database['public']['Enums']['permission_action'][] | null
          granted_at: string | null
          granted_by: string | null
          id: string
          resource: string
          team_id: string
          updated_at: string | null
          updated_by: string | null
          vault_id: string | null
        }
        Insert: {
          actions?: Database['public']['Enums']['permission_action'][] | null
          granted_at?: string | null
          granted_by?: string | null
          id?: string
          resource: string
          team_id: string
          updated_at?: string | null
          updated_by?: string | null
          vault_id?: string | null
        }
        Update: {
          actions?: Database['public']['Enums']['permission_action'][] | null
          granted_at?: string | null
          granted_by?: string | null
          id?: string
          resource?: string
          team_id?: string
          updated_at?: string | null
          updated_by?: string | null
          vault_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'team_permissions_granted_by_fkey'
            columns: ['granted_by']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'team_permissions_team_id_fkey'
            columns: ['team_id']
            isOneToOne: false
            referencedRelation: 'teams'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'team_permissions_updated_by_fkey'
            columns: ['updated_by']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
        ]
      }
      team_vault_access: {
        Row: {
          granted_at: string | null
          granted_by: string | null
          id: string
          team_id: string
          vault_id: string
        }
        Insert: {
          granted_at?: string | null
          granted_by?: string | null
          id?: string
          team_id: string
          vault_id: string
        }
        Update: {
          granted_at?: string | null
          granted_by?: string | null
          id?: string
          team_id?: string
          vault_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'team_vault_access_granted_by_fkey'
            columns: ['granted_by']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'team_vault_access_team_id_fkey'
            columns: ['team_id']
            isOneToOne: false
            referencedRelation: 'teams'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'team_vault_access_vault_id_fkey'
            columns: ['vault_id']
            isOneToOne: false
            referencedRelation: 'vaults'
            referencedColumns: ['id']
          },
        ]
      }
      teams: {
        Row: {
          color: string
          created_at: string | null
          created_by: string | null
          description: string | null
          icon: string
          id: string
          is_default: boolean | null
          is_system: boolean | null
          module_defaults: Json | null
          name: string
          org_id: string
          parent_team_id: string | null
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          color?: string
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          icon?: string
          id?: string
          is_default?: boolean | null
          is_system?: boolean | null
          module_defaults?: Json | null
          name: string
          org_id: string
          parent_team_id?: string | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          color?: string
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          icon?: string
          id?: string
          is_default?: boolean | null
          is_system?: boolean | null
          module_defaults?: Json | null
          name?: string
          org_id?: string
          parent_team_id?: string | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'teams_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'teams_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'teams_parent_team_id_fkey'
            columns: ['parent_team_id']
            isOneToOne: false
            referencedRelation: 'teams'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'teams_updated_by_fkey'
            columns: ['updated_by']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
        ]
      }
      user_job_titles: {
        Row: {
          assigned_at: string | null
          assigned_by: string | null
          id: string
          title_id: string
          user_id: string
        }
        Insert: {
          assigned_at?: string | null
          assigned_by?: string | null
          id?: string
          title_id: string
          user_id: string
        }
        Update: {
          assigned_at?: string | null
          assigned_by?: string | null
          id?: string
          title_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'user_job_titles_assigned_by_fkey'
            columns: ['assigned_by']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'user_job_titles_title_id_fkey'
            columns: ['title_id']
            isOneToOne: false
            referencedRelation: 'job_titles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'user_job_titles_user_id_fkey'
            columns: ['user_id']
            isOneToOne: true
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
        ]
      }
      user_permissions: {
        Row: {
          actions: Database['public']['Enums']['permission_action'][] | null
          granted_at: string | null
          granted_by: string | null
          id: string
          resource: string
          updated_at: string | null
          updated_by: string | null
          user_id: string
          vault_id: string | null
        }
        Insert: {
          actions?: Database['public']['Enums']['permission_action'][] | null
          granted_at?: string | null
          granted_by?: string | null
          id?: string
          resource: string
          updated_at?: string | null
          updated_by?: string | null
          user_id: string
          vault_id?: string | null
        }
        Update: {
          actions?: Database['public']['Enums']['permission_action'][] | null
          granted_at?: string | null
          granted_by?: string | null
          id?: string
          resource?: string
          updated_at?: string | null
          updated_by?: string | null
          user_id?: string
          vault_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'user_permissions_granted_by_fkey'
            columns: ['granted_by']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'user_permissions_updated_by_fkey'
            columns: ['updated_by']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'user_permissions_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
        ]
      }
      user_sessions: {
        Row: {
          app_version: string | null
          created_at: string | null
          id: string
          is_active: boolean | null
          last_active: string | null
          last_seen: string | null
          machine_id: string
          machine_name: string | null
          org_id: string
          os_version: string | null
          platform: string | null
          user_id: string
        }
        Insert: {
          app_version?: string | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          last_active?: string | null
          last_seen?: string | null
          machine_id: string
          machine_name?: string | null
          org_id: string
          os_version?: string | null
          platform?: string | null
          user_id: string
        }
        Update: {
          app_version?: string | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          last_active?: string | null
          last_seen?: string | null
          machine_id?: string
          machine_name?: string | null
          org_id?: string
          os_version?: string | null
          platform?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'user_sessions_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'user_sessions_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
        ]
      }
      user_workflow_roles: {
        Row: {
          assigned_at: string | null
          assigned_by: string | null
          id: string
          user_id: string
          workflow_role_id: string
        }
        Insert: {
          assigned_at?: string | null
          assigned_by?: string | null
          id?: string
          user_id: string
          workflow_role_id: string
        }
        Update: {
          assigned_at?: string | null
          assigned_by?: string | null
          id?: string
          user_id?: string
          workflow_role_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'user_workflow_roles_assigned_by_fkey'
            columns: ['assigned_by']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'user_workflow_roles_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'user_workflow_roles_workflow_role_id_fkey'
            columns: ['workflow_role_id']
            isOneToOne: false
            referencedRelation: 'workflow_roles'
            referencedColumns: ['id']
          },
        ]
      }
      users: {
        Row: {
          avatar_url: string | null
          created_at: string | null
          custom_avatar_url: string | null
          email: string
          full_name: string | null
          id: string
          job_title: string | null
          last_online: string | null
          last_sign_in: string | null
          org_id: string | null
          role: Database['public']['Enums']['user_role']
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string | null
          custom_avatar_url?: string | null
          email: string
          full_name?: string | null
          id: string
          job_title?: string | null
          last_online?: string | null
          last_sign_in?: string | null
          org_id?: string | null
          role?: Database['public']['Enums']['user_role']
        }
        Update: {
          avatar_url?: string | null
          created_at?: string | null
          custom_avatar_url?: string | null
          email?: string
          full_name?: string | null
          id?: string
          job_title?: string | null
          last_online?: string | null
          last_sign_in?: string | null
          org_id?: string | null
          role?: Database['public']['Enums']['user_role']
        }
        Relationships: [
          {
            foreignKeyName: 'users_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
        ]
      }
      vault_access: {
        Row: {
          granted_at: string | null
          granted_by: string | null
          id: string
          user_id: string
          vault_id: string
        }
        Insert: {
          granted_at?: string | null
          granted_by?: string | null
          id?: string
          user_id: string
          vault_id: string
        }
        Update: {
          granted_at?: string | null
          granted_by?: string | null
          id?: string
          user_id?: string
          vault_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'vault_access_granted_by_fkey'
            columns: ['granted_by']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'vault_access_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'vault_access_vault_id_fkey'
            columns: ['vault_id']
            isOneToOne: false
            referencedRelation: 'vaults'
            referencedColumns: ['id']
          },
        ]
      }
      vaults: {
        Row: {
          color: string | null
          created_at: string | null
          created_by: string | null
          description: string | null
          icon: string | null
          id: string
          is_default: boolean | null
          local_path: string | null
          name: string
          org_id: string
          slug: string
          storage_bucket: string | null
        }
        Insert: {
          color?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          icon?: string | null
          id?: string
          is_default?: boolean | null
          local_path?: string | null
          name: string
          org_id: string
          slug: string
          storage_bucket?: string | null
        }
        Update: {
          color?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          icon?: string | null
          id?: string
          is_default?: boolean | null
          local_path?: string | null
          name?: string
          org_id?: string
          slug?: string
          storage_bucket?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'vaults_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'vaults_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
        ]
      }
      webhook_deliveries: {
        Row: {
          attempt_count: number | null
          created_at: string | null
          delivered_at: string | null
          event_id: string | null
          event_type: Database['public']['Enums']['webhook_event']
          id: string
          last_error: string | null
          next_retry_at: string | null
          org_id: string
          payload: Json
          response_body: string | null
          response_headers: Json | null
          response_status: number | null
          status: Database['public']['Enums']['webhook_delivery_status'] | null
          webhook_id: string
        }
        Insert: {
          attempt_count?: number | null
          created_at?: string | null
          delivered_at?: string | null
          event_id?: string | null
          event_type: Database['public']['Enums']['webhook_event']
          id?: string
          last_error?: string | null
          next_retry_at?: string | null
          org_id: string
          payload: Json
          response_body?: string | null
          response_headers?: Json | null
          response_status?: number | null
          status?: Database['public']['Enums']['webhook_delivery_status'] | null
          webhook_id: string
        }
        Update: {
          attempt_count?: number | null
          created_at?: string | null
          delivered_at?: string | null
          event_id?: string | null
          event_type?: Database['public']['Enums']['webhook_event']
          id?: string
          last_error?: string | null
          next_retry_at?: string | null
          org_id?: string
          payload?: Json
          response_body?: string | null
          response_headers?: Json | null
          response_status?: number | null
          status?: Database['public']['Enums']['webhook_delivery_status'] | null
          webhook_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'webhook_deliveries_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'webhook_deliveries_webhook_id_fkey'
            columns: ['webhook_id']
            isOneToOne: false
            referencedRelation: 'webhooks'
            referencedColumns: ['id']
          },
        ]
      }
      webhooks: {
        Row: {
          created_at: string | null
          created_by: string | null
          custom_headers: Json
          description: string | null
          events: Database['public']['Enums']['webhook_event'][]
          failure_count: number | null
          id: string
          is_active: boolean
          last_triggered_at: string | null
          max_retries: number
          name: string
          org_id: string
          retry_delay_seconds: number
          secret: string
          success_count: number | null
          timeout_seconds: number
          trigger_filter: string
          trigger_roles: string[]
          trigger_user_ids: string[]
          updated_at: string | null
          updated_by: string | null
          url: string
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          custom_headers?: Json
          description?: string | null
          events?: Database['public']['Enums']['webhook_event'][]
          failure_count?: number | null
          id?: string
          is_active?: boolean
          last_triggered_at?: string | null
          max_retries?: number
          name: string
          org_id: string
          retry_delay_seconds?: number
          secret: string
          success_count?: number | null
          timeout_seconds?: number
          trigger_filter?: string
          trigger_roles?: string[]
          trigger_user_ids?: string[]
          updated_at?: string | null
          updated_by?: string | null
          url: string
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          custom_headers?: Json
          description?: string | null
          events?: Database['public']['Enums']['webhook_event'][]
          failure_count?: number | null
          id?: string
          is_active?: boolean
          last_triggered_at?: string | null
          max_retries?: number
          name?: string
          org_id?: string
          retry_delay_seconds?: number
          secret?: string
          success_count?: number | null
          timeout_seconds?: number
          trigger_filter?: string
          trigger_roles?: string[]
          trigger_user_ids?: string[]
          updated_at?: string | null
          updated_by?: string | null
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: 'webhooks_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'webhooks_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'webhooks_updated_by_fkey'
            columns: ['updated_by']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
        ]
      }
      woocommerce_product_mappings: {
        Row: {
          config_id: string
          created_at: string | null
          file_id: string
          id: string
          last_synced_at: string | null
          last_synced_revision: string | null
          last_synced_version: number | null
          org_id: string
          sync_error: string | null
          sync_status: string | null
          updated_at: string | null
          wc_product_id: number
          wc_product_name: string | null
          wc_product_sku: string | null
          wc_product_status: string | null
          wc_product_type: string | null
        }
        Insert: {
          config_id: string
          created_at?: string | null
          file_id: string
          id?: string
          last_synced_at?: string | null
          last_synced_revision?: string | null
          last_synced_version?: number | null
          org_id: string
          sync_error?: string | null
          sync_status?: string | null
          updated_at?: string | null
          wc_product_id: number
          wc_product_name?: string | null
          wc_product_sku?: string | null
          wc_product_status?: string | null
          wc_product_type?: string | null
        }
        Update: {
          config_id?: string
          created_at?: string | null
          file_id?: string
          id?: string
          last_synced_at?: string | null
          last_synced_revision?: string | null
          last_synced_version?: number | null
          org_id?: string
          sync_error?: string | null
          sync_status?: string | null
          updated_at?: string | null
          wc_product_id?: number
          wc_product_name?: string | null
          wc_product_sku?: string | null
          wc_product_status?: string | null
          wc_product_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'woocommerce_product_mappings_config_id_fkey'
            columns: ['config_id']
            isOneToOne: false
            referencedRelation: 'woocommerce_saved_configs'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'woocommerce_product_mappings_file_id_fkey'
            columns: ['file_id']
            isOneToOne: false
            referencedRelation: 'files'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'woocommerce_product_mappings_file_id_fkey'
            columns: ['file_id']
            isOneToOne: false
            referencedRelation: 'parts_with_pricing'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'woocommerce_product_mappings_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
        ]
      }
      woocommerce_saved_configs: {
        Row: {
          color: string | null
          consumer_key_encrypted: string | null
          consumer_secret_encrypted: string | null
          created_at: string | null
          created_by: string | null
          description: string | null
          id: string
          is_active: boolean | null
          last_sync_at: string | null
          last_sync_count: number | null
          last_sync_status: string | null
          last_test_error: string | null
          last_test_success: boolean | null
          last_tested_at: string | null
          name: string
          org_id: string
          store_name: string | null
          store_url: string
          sync_settings: Json | null
          updated_at: string | null
          updated_by: string | null
          wc_version: string | null
        }
        Insert: {
          color?: string | null
          consumer_key_encrypted?: string | null
          consumer_secret_encrypted?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          last_sync_at?: string | null
          last_sync_count?: number | null
          last_sync_status?: string | null
          last_test_error?: string | null
          last_test_success?: boolean | null
          last_tested_at?: string | null
          name: string
          org_id: string
          store_name?: string | null
          store_url: string
          sync_settings?: Json | null
          updated_at?: string | null
          updated_by?: string | null
          wc_version?: string | null
        }
        Update: {
          color?: string | null
          consumer_key_encrypted?: string | null
          consumer_secret_encrypted?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          last_sync_at?: string | null
          last_sync_count?: number | null
          last_sync_status?: string | null
          last_test_error?: string | null
          last_test_success?: boolean | null
          last_tested_at?: string | null
          name?: string
          org_id?: string
          store_name?: string | null
          store_url?: string
          sync_settings?: Json | null
          updated_at?: string | null
          updated_by?: string | null
          wc_version?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'woocommerce_saved_configs_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'woocommerce_saved_configs_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'woocommerce_saved_configs_updated_by_fkey'
            columns: ['updated_by']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
        ]
      }
      workflow_approval_reviewers: {
        Row: {
          approval_id: string
          created_at: string | null
          id: string
          reviewer_type: Database['public']['Enums']['notification_recipient_type']
          role: Database['public']['Enums']['user_role'] | null
          user_id: string | null
          workflow_role_id: string | null
        }
        Insert: {
          approval_id: string
          created_at?: string | null
          id?: string
          reviewer_type: Database['public']['Enums']['notification_recipient_type']
          role?: Database['public']['Enums']['user_role'] | null
          user_id?: string | null
          workflow_role_id?: string | null
        }
        Update: {
          approval_id?: string
          created_at?: string | null
          id?: string
          reviewer_type?: Database['public']['Enums']['notification_recipient_type']
          role?: Database['public']['Enums']['user_role'] | null
          user_id?: string | null
          workflow_role_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'workflow_approval_reviewers_approval_id_fkey'
            columns: ['approval_id']
            isOneToOne: false
            referencedRelation: 'workflow_transition_approvals'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'workflow_approval_reviewers_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'workflow_approval_reviewers_workflow_role_id_fkey'
            columns: ['workflow_role_id']
            isOneToOne: false
            referencedRelation: 'workflow_roles'
            referencedColumns: ['id']
          },
        ]
      }
      workflow_auto_transitions: {
        Row: {
          condition_expression: Json | null
          created_at: string | null
          id: string
          is_active: boolean | null
          schedule_cron: string | null
          schedule_timezone: string | null
          timer_hours: number | null
          transition_id: string
          trigger_type: Database['public']['Enums']['auto_trigger_type']
        }
        Insert: {
          condition_expression?: Json | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          schedule_cron?: string | null
          schedule_timezone?: string | null
          timer_hours?: number | null
          transition_id: string
          trigger_type: Database['public']['Enums']['auto_trigger_type']
        }
        Update: {
          condition_expression?: Json | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          schedule_cron?: string | null
          schedule_timezone?: string | null
          timer_hours?: number | null
          transition_id?: string
          trigger_type?: Database['public']['Enums']['auto_trigger_type']
        }
        Relationships: [
          {
            foreignKeyName: 'workflow_auto_transitions_transition_id_fkey'
            columns: ['transition_id']
            isOneToOne: false
            referencedRelation: 'workflow_transitions'
            referencedColumns: ['id']
          },
        ]
      }
      workflow_gate_reviewers: {
        Row: {
          created_at: string | null
          gate_id: string
          group_name: string | null
          id: string
          reviewer_type: Database['public']['Enums']['reviewer_type']
          role: Database['public']['Enums']['user_role'] | null
          user_id: string | null
          workflow_role_id: string | null
        }
        Insert: {
          created_at?: string | null
          gate_id: string
          group_name?: string | null
          id?: string
          reviewer_type: Database['public']['Enums']['reviewer_type']
          role?: Database['public']['Enums']['user_role'] | null
          user_id?: string | null
          workflow_role_id?: string | null
        }
        Update: {
          created_at?: string | null
          gate_id?: string
          group_name?: string | null
          id?: string
          reviewer_type?: Database['public']['Enums']['reviewer_type']
          role?: Database['public']['Enums']['user_role'] | null
          user_id?: string | null
          workflow_role_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'fk_workflow_gate_reviewers_workflow_role'
            columns: ['workflow_role_id']
            isOneToOne: false
            referencedRelation: 'workflow_roles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'workflow_gate_reviewers_gate_id_fkey'
            columns: ['gate_id']
            isOneToOne: false
            referencedRelation: 'workflow_gates'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'workflow_gate_reviewers_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
        ]
      }
      workflow_gates: {
        Row: {
          approval_mode: Database['public']['Enums']['approval_mode'] | null
          can_be_skipped_by: Database['public']['Enums']['user_role'][] | null
          checklist_items: Json | null
          conditions: Json | null
          created_at: string | null
          description: string | null
          gate_type: Database['public']['Enums']['gate_type'] | null
          id: string
          is_blocking: boolean | null
          name: string
          required_approvals: number | null
          sort_order: number | null
          transition_id: string
        }
        Insert: {
          approval_mode?: Database['public']['Enums']['approval_mode'] | null
          can_be_skipped_by?: Database['public']['Enums']['user_role'][] | null
          checklist_items?: Json | null
          conditions?: Json | null
          created_at?: string | null
          description?: string | null
          gate_type?: Database['public']['Enums']['gate_type'] | null
          id?: string
          is_blocking?: boolean | null
          name: string
          required_approvals?: number | null
          sort_order?: number | null
          transition_id: string
        }
        Update: {
          approval_mode?: Database['public']['Enums']['approval_mode'] | null
          can_be_skipped_by?: Database['public']['Enums']['user_role'][] | null
          checklist_items?: Json | null
          conditions?: Json | null
          created_at?: string | null
          description?: string | null
          gate_type?: Database['public']['Enums']['gate_type'] | null
          id?: string
          is_blocking?: boolean | null
          name?: string
          required_approvals?: number | null
          sort_order?: number | null
          transition_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'workflow_gates_transition_id_fkey'
            columns: ['transition_id']
            isOneToOne: false
            referencedRelation: 'workflow_transitions'
            referencedColumns: ['id']
          },
        ]
      }
      workflow_history: {
        Row: {
          approvals_data: Json | null
          comment: string | null
          created_at: string | null
          file_id: string | null
          file_name: string
          file_path: string
          from_state_id: string | null
          from_state_name: string
          id: string
          org_id: string
          performed_at: string
          performed_by: string | null
          performed_by_email: string
          revision_after: string | null
          revision_before: string | null
          to_state_id: string | null
          to_state_name: string
          transition_id: string | null
          transition_name: string | null
          workflow_id: string | null
          workflow_name: string
        }
        Insert: {
          approvals_data?: Json | null
          comment?: string | null
          created_at?: string | null
          file_id?: string | null
          file_name: string
          file_path: string
          from_state_id?: string | null
          from_state_name: string
          id?: string
          org_id: string
          performed_at?: string
          performed_by?: string | null
          performed_by_email: string
          revision_after?: string | null
          revision_before?: string | null
          to_state_id?: string | null
          to_state_name: string
          transition_id?: string | null
          transition_name?: string | null
          workflow_id?: string | null
          workflow_name: string
        }
        Update: {
          approvals_data?: Json | null
          comment?: string | null
          created_at?: string | null
          file_id?: string | null
          file_name?: string
          file_path?: string
          from_state_id?: string | null
          from_state_name?: string
          id?: string
          org_id?: string
          performed_at?: string
          performed_by?: string | null
          performed_by_email?: string
          revision_after?: string | null
          revision_before?: string | null
          to_state_id?: string | null
          to_state_name?: string
          transition_id?: string | null
          transition_name?: string | null
          workflow_id?: string | null
          workflow_name?: string
        }
        Relationships: [
          {
            foreignKeyName: 'workflow_history_file_id_fkey'
            columns: ['file_id']
            isOneToOne: false
            referencedRelation: 'files'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'workflow_history_file_id_fkey'
            columns: ['file_id']
            isOneToOne: false
            referencedRelation: 'parts_with_pricing'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'workflow_history_from_state_id_fkey'
            columns: ['from_state_id']
            isOneToOne: false
            referencedRelation: 'workflow_states'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'workflow_history_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'workflow_history_performed_by_fkey'
            columns: ['performed_by']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'workflow_history_to_state_id_fkey'
            columns: ['to_state_id']
            isOneToOne: false
            referencedRelation: 'workflow_states'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'workflow_history_transition_id_fkey'
            columns: ['transition_id']
            isOneToOne: false
            referencedRelation: 'workflow_transitions'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'workflow_history_workflow_id_fkey'
            columns: ['workflow_id']
            isOneToOne: false
            referencedRelation: 'workflow_templates'
            referencedColumns: ['id']
          },
        ]
      }
      workflow_review_history: {
        Row: {
          checklist_responses: Json | null
          comment: string | null
          created_at: string | null
          decision: string
          file_id: string | null
          file_name: string
          file_path: string
          from_state_name: string
          gate_id: string | null
          gate_name: string
          id: string
          org_id: string
          requested_at: string
          requested_by: string | null
          requested_by_email: string
          reviewed_at: string
          reviewed_by: string | null
          reviewed_by_email: string
          to_state_name: string
          transition_id: string | null
          workflow_id: string | null
          workflow_name: string
        }
        Insert: {
          checklist_responses?: Json | null
          comment?: string | null
          created_at?: string | null
          decision: string
          file_id?: string | null
          file_name: string
          file_path: string
          from_state_name: string
          gate_id?: string | null
          gate_name: string
          id?: string
          org_id: string
          requested_at: string
          requested_by?: string | null
          requested_by_email: string
          reviewed_at: string
          reviewed_by?: string | null
          reviewed_by_email: string
          to_state_name: string
          transition_id?: string | null
          workflow_id?: string | null
          workflow_name: string
        }
        Update: {
          checklist_responses?: Json | null
          comment?: string | null
          created_at?: string | null
          decision?: string
          file_id?: string | null
          file_name?: string
          file_path?: string
          from_state_name?: string
          gate_id?: string | null
          gate_name?: string
          id?: string
          org_id?: string
          requested_at?: string
          requested_by?: string | null
          requested_by_email?: string
          reviewed_at?: string
          reviewed_by?: string | null
          reviewed_by_email?: string
          to_state_name?: string
          transition_id?: string | null
          workflow_id?: string | null
          workflow_name?: string
        }
        Relationships: [
          {
            foreignKeyName: 'workflow_review_history_file_id_fkey'
            columns: ['file_id']
            isOneToOne: false
            referencedRelation: 'files'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'workflow_review_history_file_id_fkey'
            columns: ['file_id']
            isOneToOne: false
            referencedRelation: 'parts_with_pricing'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'workflow_review_history_gate_id_fkey'
            columns: ['gate_id']
            isOneToOne: false
            referencedRelation: 'workflow_gates'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'workflow_review_history_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'workflow_review_history_requested_by_fkey'
            columns: ['requested_by']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'workflow_review_history_reviewed_by_fkey'
            columns: ['reviewed_by']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'workflow_review_history_transition_id_fkey'
            columns: ['transition_id']
            isOneToOne: false
            referencedRelation: 'workflow_transitions'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'workflow_review_history_workflow_id_fkey'
            columns: ['workflow_id']
            isOneToOne: false
            referencedRelation: 'workflow_templates'
            referencedColumns: ['id']
          },
        ]
      }
      workflow_roles: {
        Row: {
          color: string | null
          created_at: string | null
          created_by: string | null
          description: string | null
          icon: string | null
          id: string
          is_active: boolean | null
          name: string
          org_id: string
          sort_order: number | null
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          color?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          icon?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          org_id: string
          sort_order?: number | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          color?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          icon?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          org_id?: string
          sort_order?: number | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'workflow_roles_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'workflow_roles_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'workflow_roles_updated_by_fkey'
            columns: ['updated_by']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
        ]
      }
      workflow_state_permissions: {
        Row: {
          can_add: boolean | null
          can_change_state: boolean | null
          can_delete: boolean | null
          can_edit_metadata: boolean | null
          can_read: boolean | null
          can_rename: boolean | null
          can_write: boolean | null
          comment_required_on_change: boolean | null
          created_at: string | null
          id: string
          permission_for: string
          role: Database['public']['Enums']['user_role'] | null
          state_id: string
          user_id: string | null
          workflow_role_id: string | null
        }
        Insert: {
          can_add?: boolean | null
          can_change_state?: boolean | null
          can_delete?: boolean | null
          can_edit_metadata?: boolean | null
          can_read?: boolean | null
          can_rename?: boolean | null
          can_write?: boolean | null
          comment_required_on_change?: boolean | null
          created_at?: string | null
          id?: string
          permission_for: string
          role?: Database['public']['Enums']['user_role'] | null
          state_id: string
          user_id?: string | null
          workflow_role_id?: string | null
        }
        Update: {
          can_add?: boolean | null
          can_change_state?: boolean | null
          can_delete?: boolean | null
          can_edit_metadata?: boolean | null
          can_read?: boolean | null
          can_rename?: boolean | null
          can_write?: boolean | null
          comment_required_on_change?: boolean | null
          created_at?: string | null
          id?: string
          permission_for?: string
          role?: Database['public']['Enums']['user_role'] | null
          state_id?: string
          user_id?: string | null
          workflow_role_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'workflow_state_permissions_state_id_fkey'
            columns: ['state_id']
            isOneToOne: false
            referencedRelation: 'workflow_states'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'workflow_state_permissions_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'workflow_state_permissions_workflow_role_id_fkey'
            columns: ['workflow_role_id']
            isOneToOne: false
            referencedRelation: 'workflow_roles'
            referencedColumns: ['id']
          },
        ]
      }
      workflow_states: {
        Row: {
          auto_increment_revision: boolean | null
          border_color: string | null
          border_opacity: number | null
          border_thickness: number | null
          color: string | null
          corner_radius: number | null
          created_at: string | null
          description: string | null
          fill_opacity: number | null
          gate_config: Json | null
          icon: string | null
          id: string
          is_editable: boolean | null
          label: string | null
          name: string
          position_x: number | null
          position_y: number | null
          required_workflow_roles: string[] | null
          requires_checkout: boolean | null
          shape: Database['public']['Enums']['state_shape'] | null
          sort_order: number | null
          state_type: Database['public']['Enums']['state_type'] | null
          triggers_review: boolean | null
          workflow_id: string
        }
        Insert: {
          auto_increment_revision?: boolean | null
          border_color?: string | null
          border_opacity?: number | null
          border_thickness?: number | null
          color?: string | null
          corner_radius?: number | null
          created_at?: string | null
          description?: string | null
          fill_opacity?: number | null
          gate_config?: Json | null
          icon?: string | null
          id?: string
          is_editable?: boolean | null
          label?: string | null
          name: string
          position_x?: number | null
          position_y?: number | null
          required_workflow_roles?: string[] | null
          requires_checkout?: boolean | null
          shape?: Database['public']['Enums']['state_shape'] | null
          sort_order?: number | null
          state_type?: Database['public']['Enums']['state_type'] | null
          triggers_review?: boolean | null
          workflow_id: string
        }
        Update: {
          auto_increment_revision?: boolean | null
          border_color?: string | null
          border_opacity?: number | null
          border_thickness?: number | null
          color?: string | null
          corner_radius?: number | null
          created_at?: string | null
          description?: string | null
          fill_opacity?: number | null
          gate_config?: Json | null
          icon?: string | null
          id?: string
          is_editable?: boolean | null
          label?: string | null
          name?: string
          position_x?: number | null
          position_y?: number | null
          required_workflow_roles?: string[] | null
          requires_checkout?: boolean | null
          shape?: Database['public']['Enums']['state_shape'] | null
          sort_order?: number | null
          state_type?: Database['public']['Enums']['state_type'] | null
          triggers_review?: boolean | null
          workflow_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'workflow_states_workflow_id_fkey'
            columns: ['workflow_id']
            isOneToOne: false
            referencedRelation: 'workflow_templates'
            referencedColumns: ['id']
          },
        ]
      }
      workflow_tasks: {
        Row: {
          config: Json | null
          created_at: string | null
          created_by: string | null
          description: string | null
          id: string
          is_active: boolean | null
          name: string
          org_id: string
          task_type: Database['public']['Enums']['workflow_task_type']
          updated_at: string | null
        }
        Insert: {
          config?: Json | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          org_id: string
          task_type: Database['public']['Enums']['workflow_task_type']
          updated_at?: string | null
        }
        Update: {
          config?: Json | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          org_id?: string
          task_type?: Database['public']['Enums']['workflow_task_type']
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'workflow_tasks_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'workflow_tasks_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
        ]
      }
      workflow_templates: {
        Row: {
          canvas_config: Json | null
          created_at: string | null
          created_by: string | null
          description: string | null
          id: string
          is_active: boolean | null
          is_default: boolean | null
          name: string
          org_id: string
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          canvas_config?: Json | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          is_default?: boolean | null
          name: string
          org_id: string
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          canvas_config?: Json | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          is_default?: boolean | null
          name?: string
          org_id?: string
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'workflow_templates_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'workflow_templates_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'workflow_templates_updated_by_fkey'
            columns: ['updated_by']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
        ]
      }
      workflow_transition_actions: {
        Row: {
          action_type: Database['public']['Enums']['action_type']
          config: Json | null
          created_at: string | null
          execute_on: string | null
          id: string
          is_active: boolean | null
          sort_order: number | null
          transition_id: string
        }
        Insert: {
          action_type: Database['public']['Enums']['action_type']
          config?: Json | null
          created_at?: string | null
          execute_on?: string | null
          id?: string
          is_active?: boolean | null
          sort_order?: number | null
          transition_id: string
        }
        Update: {
          action_type?: Database['public']['Enums']['action_type']
          config?: Json | null
          created_at?: string | null
          execute_on?: string | null
          id?: string
          is_active?: boolean | null
          sort_order?: number | null
          transition_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'workflow_transition_actions_transition_id_fkey'
            columns: ['transition_id']
            isOneToOne: false
            referencedRelation: 'workflow_transitions'
            referencedColumns: ['id']
          },
        ]
      }
      workflow_transition_approvals: {
        Row: {
          allow_self_approval: boolean | null
          approval_mode: Database['public']['Enums']['approval_mode'] | null
          created_at: string | null
          description: string | null
          escalation_user_id: string | null
          id: string
          is_active: boolean | null
          name: string
          require_comment: boolean | null
          required_approvals: number | null
          sort_order: number | null
          timeout_hours: number | null
          transition_id: string
        }
        Insert: {
          allow_self_approval?: boolean | null
          approval_mode?: Database['public']['Enums']['approval_mode'] | null
          created_at?: string | null
          description?: string | null
          escalation_user_id?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          require_comment?: boolean | null
          required_approvals?: number | null
          sort_order?: number | null
          timeout_hours?: number | null
          transition_id: string
        }
        Update: {
          allow_self_approval?: boolean | null
          approval_mode?: Database['public']['Enums']['approval_mode'] | null
          created_at?: string | null
          description?: string | null
          escalation_user_id?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          require_comment?: boolean | null
          required_approvals?: number | null
          sort_order?: number | null
          timeout_hours?: number | null
          transition_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'workflow_transition_approvals_escalation_user_id_fkey'
            columns: ['escalation_user_id']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'workflow_transition_approvals_transition_id_fkey'
            columns: ['transition_id']
            isOneToOne: false
            referencedRelation: 'workflow_transitions'
            referencedColumns: ['id']
          },
        ]
      }
      workflow_transition_conditions: {
        Row: {
          condition_type: Database['public']['Enums']['condition_type']
          created_at: string | null
          custom_sql: string | null
          id: string
          is_required: boolean | null
          operator: string
          sort_order: number | null
          transition_id: string
          value: string | null
          value_list: string[] | null
        }
        Insert: {
          condition_type: Database['public']['Enums']['condition_type']
          created_at?: string | null
          custom_sql?: string | null
          id?: string
          is_required?: boolean | null
          operator?: string
          sort_order?: number | null
          transition_id: string
          value?: string | null
          value_list?: string[] | null
        }
        Update: {
          condition_type?: Database['public']['Enums']['condition_type']
          created_at?: string | null
          custom_sql?: string | null
          id?: string
          is_required?: boolean | null
          operator?: string
          sort_order?: number | null
          transition_id?: string
          value?: string | null
          value_list?: string[] | null
        }
        Relationships: [
          {
            foreignKeyName: 'workflow_transition_conditions_transition_id_fkey'
            columns: ['transition_id']
            isOneToOne: false
            referencedRelation: 'workflow_transitions'
            referencedColumns: ['id']
          },
        ]
      }
      workflow_transition_notifications: {
        Row: {
          body_template: string
          created_at: string | null
          id: string
          is_active: boolean | null
          recipient_role: Database['public']['Enums']['user_role'] | null
          recipient_type: Database['public']['Enums']['notification_recipient_type']
          recipient_user_id: string | null
          recipient_workflow_role_id: string | null
          send_email: boolean | null
          send_in_app: boolean | null
          subject_template: string
          transition_id: string
        }
        Insert: {
          body_template: string
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          recipient_role?: Database['public']['Enums']['user_role'] | null
          recipient_type: Database['public']['Enums']['notification_recipient_type']
          recipient_user_id?: string | null
          recipient_workflow_role_id?: string | null
          send_email?: boolean | null
          send_in_app?: boolean | null
          subject_template: string
          transition_id: string
        }
        Update: {
          body_template?: string
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          recipient_role?: Database['public']['Enums']['user_role'] | null
          recipient_type?: Database['public']['Enums']['notification_recipient_type']
          recipient_user_id?: string | null
          recipient_workflow_role_id?: string | null
          send_email?: boolean | null
          send_in_app?: boolean | null
          subject_template?: string
          transition_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'workflow_transition_notificatio_recipient_workflow_role_id_fkey'
            columns: ['recipient_workflow_role_id']
            isOneToOne: false
            referencedRelation: 'workflow_roles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'workflow_transition_notifications_recipient_user_id_fkey'
            columns: ['recipient_user_id']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'workflow_transition_notifications_transition_id_fkey'
            columns: ['transition_id']
            isOneToOne: false
            referencedRelation: 'workflow_transitions'
            referencedColumns: ['id']
          },
        ]
      }
      workflow_transitions: {
        Row: {
          allowed_workflow_roles: string[] | null
          auto_conditions: Json | null
          created_at: string | null
          description: string | null
          from_state_id: string
          id: string
          line_arrow_head: Database['public']['Enums']['transition_arrow_head'] | null
          line_color: string | null
          line_path_type: Database['public']['Enums']['transition_path_type'] | null
          line_style: Database['public']['Enums']['transition_line_style'] | null
          line_thickness: number | null
          name: string | null
          to_state_id: string
          workflow_id: string
        }
        Insert: {
          allowed_workflow_roles?: string[] | null
          auto_conditions?: Json | null
          created_at?: string | null
          description?: string | null
          from_state_id: string
          id?: string
          line_arrow_head?: Database['public']['Enums']['transition_arrow_head'] | null
          line_color?: string | null
          line_path_type?: Database['public']['Enums']['transition_path_type'] | null
          line_style?: Database['public']['Enums']['transition_line_style'] | null
          line_thickness?: number | null
          name?: string | null
          to_state_id: string
          workflow_id: string
        }
        Update: {
          allowed_workflow_roles?: string[] | null
          auto_conditions?: Json | null
          created_at?: string | null
          description?: string | null
          from_state_id?: string
          id?: string
          line_arrow_head?: Database['public']['Enums']['transition_arrow_head'] | null
          line_color?: string | null
          line_path_type?: Database['public']['Enums']['transition_path_type'] | null
          line_style?: Database['public']['Enums']['transition_line_style'] | null
          line_thickness?: number | null
          name?: string | null
          to_state_id?: string
          workflow_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'workflow_transitions_from_state_id_fkey'
            columns: ['from_state_id']
            isOneToOne: false
            referencedRelation: 'workflow_states'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'workflow_transitions_to_state_id_fkey'
            columns: ['to_state_id']
            isOneToOne: false
            referencedRelation: 'workflow_states'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'workflow_transitions_workflow_id_fkey'
            columns: ['workflow_id']
            isOneToOne: false
            referencedRelation: 'workflow_templates'
            referencedColumns: ['id']
          },
        ]
      }
    }
    Views: {
      parts_with_pricing: {
        Row: {
          created_at: string | null
          description: string | null
          file_name: string | null
          file_path: string | null
          file_type: Database['public']['Enums']['file_type'] | null
          id: string | null
          lowest_price: number | null
          org_id: string | null
          part_number: string | null
          preferred_supplier: Json | null
          revision: string | null
          state: string | null
          supplier_count: number | null
          updated_at: string | null
          vault_id: string | null
          version: number | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          file_name?: string | null
          file_path?: string | null
          file_type?: Database['public']['Enums']['file_type'] | null
          id?: string | null
          lowest_price?: never
          org_id?: string | null
          part_number?: string | null
          preferred_supplier?: never
          revision?: string | null
          state?: string | null
          supplier_count?: never
          updated_at?: string | null
          vault_id?: string | null
          version?: number | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          file_name?: string | null
          file_path?: string | null
          file_type?: Database['public']['Enums']['file_type'] | null
          id?: string | null
          lowest_price?: never
          org_id?: string | null
          part_number?: string | null
          preferred_supplier?: never
          revision?: string | null
          state?: string | null
          supplier_count?: never
          updated_at?: string | null
          vault_id?: string | null
          version?: number | null
        }
        Relationships: [
          {
            foreignKeyName: 'files_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'files_vault_id_fkey'
            columns: ['vault_id']
            isOneToOne: false
            referencedRelation: 'vaults'
            referencedColumns: ['id']
          },
        ]
      }
    }
    Functions: {
      activate_solidworks_license: {
        Args: {
          p_assignment_id: string
          p_machine_id: string
          p_machine_name?: string
        }
        Returns: Json
      }
      add_pending_license_assignment: {
        Args: { p_license_id: string; p_pending_member_id: string }
        Returns: Json
      }
      admin_remove_user: { Args: { p_user_email: string }; Returns: Json }
      apply_pending_license_assignments: {
        Args: { p_user_id: string }
        Returns: undefined
      }
      apply_pending_team_memberships: {
        Args: { p_user_id: string }
        Returns: undefined
      }
      approve_eco_gate: {
        Args: { p_eco_id: string; p_gate_name: string; p_notes?: string }
        Returns: Json
      }
      assign_solidworks_license: {
        Args: { p_license_id: string; p_user_id: string }
        Returns: Json
      }
      block_user: {
        Args: { p_email: string; p_reason?: string }
        Returns: Json
      }
      calculate_bom_cost: {
        Args: { p_assembly_id: string; p_quantity?: number }
        Returns: {
          assembly_id: string
          assembly_name: string
          assembly_part_number: string
          component_count: number
          currency: string
          missing_pricing_count: number
          total_cost: number
        }[]
      }
      check_file_state_permission: {
        Args: { p_file_id: string; p_permission: string; p_user_id: string }
        Returns: boolean
      }
      check_gate_requirements: {
        Args: { p_eco_id: string; p_gate_name: string }
        Returns: {
          all_required_complete: boolean
          completed_items: number
          incomplete_items: string[]
          required_items: number
        }[]
      }
      checkin_file: {
        Args: {
          p_comment?: string
          p_custom_properties?: Json
          p_description?: string
          p_file_id: string
          p_inspection_hash?: string
          p_local_active_version?: number
          p_new_content_hash?: string
          p_new_file_name?: string
          p_new_file_path?: string
          p_new_file_size?: number
          p_part_number?: string
          p_revision?: string
          p_user_id: string
        }
        Returns: Json
      }
      checkout_file: {
        Args: {
          p_file_id: string
          p_lock_message?: string
          p_machine_id?: string
          p_machine_name?: string
          p_user_id: string
        }
        Returns: Json
      }
      cleanup_stale_sessions: { Args: never; Returns: number }
      clear_team_module_defaults: { Args: { p_team_id: string }; Returns: Json }
      create_default_job_titles: {
        Args: { p_created_by?: string; p_org_id: string }
        Returns: undefined
      }
      create_default_permission_teams: {
        Args: { p_created_by?: string; p_org_id: string }
        Returns: undefined
      }
      create_default_revision_scheme: {
        Args: { p_created_by: string; p_org_id: string }
        Returns: string
      }
      create_default_workflow: {
        Args: { p_created_by: string; p_org_id: string }
        Returns: string
      }
      create_default_workflow_v2: {
        Args: { p_created_by: string; p_org_id: string }
        Returns: string
      }
      create_file_share_link: {
        Args: {
          p_created_by: string
          p_expires_in_days?: number
          p_file_id: string
          p_max_downloads?: number
          p_org_id: string
          p_require_auth?: boolean
        }
        Returns: {
          expires_at: string
          link_id: string
          token: string
        }[]
      }
      create_review_request: {
        Args: {
          p_file_id: string
          p_file_version?: number
          p_message?: string
          p_org_id: string
          p_requested_by: string
          p_reviewer_ids: string[]
          p_title?: string
          p_vault_id: string
        }
        Returns: string
      }
      deactivate_solidworks_license: {
        Args: { p_assignment_id: string }
        Returns: Json
      }
      delete_user_account: { Args: never; Returns: Json }
      drop_function_overloads: {
        Args: { func_name: string }
        Returns: undefined
      }
      ensure_user_org_id: { Args: never; Returns: Json }
      execute_workflow_transition: {
        Args: {
          p_comment?: string
          p_file_id: string
          p_transition_id: string
          p_user_id: string
        }
        Returns: Json
      }
      extend_backup_lock: {
        Args: {
          p_additional_minutes?: number
          p_machine_id: string
          p_org_id: string
        }
        Returns: boolean
      }
      force_org_column_defaults: {
        Args: {
          p_column_defaults: Json
          p_org_id: string
        }
        Returns: Json
      }
      force_org_module_defaults: {
        Args: {
          p_custom_groups?: Json
          p_dividers: Json
          p_enabled_groups: Json
          p_enabled_modules: Json
          p_module_icon_colors?: Json
          p_module_order: Json
          p_module_parents?: Json
          p_org_id: string
        }
        Returns: Json
      }
      generate_share_token: { Args: never; Returns: string }
      get_available_transitions:
        | {
            Args: { p_file_id: string }
            Returns: {
              has_gates: boolean
              to_state_color: string
              to_state_id: string
              to_state_name: string
              transition_id: string
              transition_name: string
              user_can_transition: boolean
            }[]
          }
        | {
            Args: { p_file_id: string; p_user_id: string }
            Returns: {
              has_gates: boolean
              to_state_color: string
              to_state_id: string
              to_state_name: string
              transition_id: string
              transition_name: string
              user_can_transition: boolean
            }[]
          }
      get_best_price: {
        Args: { p_file_id: string; p_quantity?: number }
        Returns: {
          currency: string
          is_preferred: boolean
          lead_time_days: number
          supplier_code: string
          supplier_id: string
          supplier_name: string
          supplier_part_number: string
          total_price: number
          unit_price: number
        }[]
      }
      get_eco_files: {
        Args: { p_eco_id: string }
        Returns: {
          file_id: string
          file_name: string
          file_path: string
          notes: string
          part_number: string
          revision: string
          tagged_at: string
          tagged_by: string
        }[]
      }
      get_file_ecos: {
        Args: { p_file_id: string }
        Returns: {
          created_at: string
          eco_id: string
          eco_number: string
          notes: string
          status: string
          tagged_at: string
          title: string
        }[]
      }
      get_google_drive_settings: {
        Args: { p_org_id: string }
        Returns: {
          client_id: string
          client_secret: string
          enabled: boolean
          inspection_template_folder_id: string
        }[]
      }
      get_my_pending_reviews: {
        Args: never
        Returns: {
          file_id: string
          file_name: string
          file_path: string
          gate_name: string
          requested_at: string
          requested_by_name: string
          review_id: string
        }[]
      }
      get_next_revision: {
        Args: {
          p_current_revision: string
          p_increment_type?: string
          p_scheme_id: string
        }
        Returns: string
      }
      get_next_serial_number: { Args: { p_org_id: string }; Returns: string }
      get_odoo_integration: {
        Args: { p_org_id: string }
        Returns: {
          auto_sync: boolean
          database: string
          id: string
          is_connected: boolean
          last_sync_at: string
          last_sync_count: number
          last_sync_status: string
          url: string
          username: string
        }[]
      }
      get_odoo_saved_configs: {
        Args: { p_org_id: string }
        Returns: {
          color: string
          created_at: string
          database: string
          description: string
          id: string
          is_active: boolean
          last_test_success: boolean
          last_tested_at: string
          name: string
          url: string
          username: string
        }[]
      }
      get_org_auth_providers: { Args: { p_org_slug: string }; Returns: Json }
      get_org_integration_status: {
        Args: { p_integration_type: string; p_org_id: string }
        Returns: {
          auto_sync: boolean
          id: string
          integration_type: string
          is_active: boolean
          is_connected: boolean
          last_connected_at: string
          last_sync_at: string
          last_sync_count: number
          last_sync_status: string
        }[]
      }
      get_org_column_defaults: { Args: { p_org_id: string }; Returns: Json }
      get_org_module_defaults: { Args: { p_org_id: string }; Returns: Json }
      get_org_odoo_configs: {
        Args: { p_org_id: string }
        Returns: {
          color: string
          created_at: string
          database: string
          description: string
          id: string
          is_active: boolean
          last_test_success: boolean
          last_tested_at: string
          name: string
          url: string
        }[]
      }
      get_team_module_defaults: { Args: { p_team_id: string }; Returns: Json }
      get_unread_notification_count: {
        Args: { p_user_id: string }
        Returns: number
      }
      get_user_module_defaults:
        | { Args: never; Returns: Json }
        | { Args: { p_user_id?: string }; Returns: Json }
      get_user_permissions: {
        Args: { p_user_id: string; p_vault_id?: string }
        Returns: {
          actions: Database['public']['Enums']['permission_action'][]
          resource: string
          vault_id: string
        }[]
      }
      get_user_vault_access: {
        Args: { p_user_id: string }
        Returns: {
          vault_id: string
        }[]
      }
      get_vault_files_delta: {
        Args: { p_org_id: string; p_since: string; p_vault_id: string }
        Returns: {
          checked_out_at: string
          checked_out_by: string
          content_hash: string
          deleted_at: string
          description: string
          extension: string
          file_name: string
          file_path: string
          file_size: number
          file_type: Database['public']['Enums']['file_type']
          id: string
          is_deleted: boolean
          part_number: string
          revision: string
          state: string
          updated_at: string
          version: number
        }[]
      }
      get_vault_files_fast: {
        Args: { p_org_id: string; p_vault_id?: string }
        Returns: {
          checked_out_at: string
          checked_out_by: string
          content_hash: string
          description: string
          extension: string
          file_name: string
          file_path: string
          file_size: number
          file_type: Database['public']['Enums']['file_type']
          id: string
          part_number: string
          revision: string
          state: string
          updated_at: string
          version: number
        }[]
      }
      get_webhooks_for_event: {
        Args: {
          p_event_type: Database['public']['Enums']['webhook_event']
          p_org_id: string
        }
        Returns: {
          created_at: string | null
          created_by: string | null
          custom_headers: Json
          description: string | null
          events: Database['public']['Enums']['webhook_event'][]
          failure_count: number | null
          id: string
          is_active: boolean
          last_triggered_at: string | null
          max_retries: number
          name: string
          org_id: string
          retry_delay_seconds: number
          secret: string
          success_count: number | null
          timeout_seconds: number
          trigger_filter: string
          trigger_roles: string[]
          trigger_user_ids: string[]
          updated_at: string | null
          updated_by: string | null
          url: string
        }[]
        SetofOptions: {
          from: '*'
          to: 'webhooks'
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_woocommerce_saved_configs: {
        Args: { p_org_id: string }
        Returns: {
          color: string
          created_at: string
          description: string
          id: string
          is_active: boolean
          last_sync_at: string
          last_sync_count: number
          last_sync_status: string
          last_test_success: boolean
          last_tested_at: string
          name: string
          store_name: string
          store_url: string
        }[]
      }
      instantiate_process_template: {
        Args: { p_eco_id: string; p_template_id: string }
        Returns: undefined
      }
      is_org_admin:
        | { Args: never; Returns: boolean }
        | { Args: { p_user_id: string }; Returns: boolean }
      join_org_by_slug: { Args: { p_org_slug: string }; Returns: Json }
      mark_all_notifications_read: {
        Args: { p_user_id: string }
        Returns: number
      }
      mark_notifications_read: {
        Args: { p_notification_ids: string[] }
        Returns: number
      }
      move_file: {
        Args: {
          p_file_id: string
          p_new_file_name?: string
          p_new_file_path: string
          p_user_id: string
        }
        Returns: Json
      }
      notify_overdue_reviews: { Args: never; Returns: number }
      preview_next_serial_number: {
        Args: { p_org_id: string }
        Returns: string
      }
      regenerate_org_slug: { Args: never; Returns: Json }
      remove_pending_license_assignment: {
        Args: { p_license_id: string; p_pending_member_id: string }
        Returns: Json
      }
      rename_folder_files: {
        Args: {
          p_old_folder_path: string
          p_new_folder_path: string
          p_user_id: string
          p_vault_id?: string
        }
        Returns: Json
      }
      set_org_column_defaults: {
        Args: {
          p_column_defaults: Json
          p_org_id: string
        }
        Returns: Json
      }
      set_org_module_defaults: {
        Args: {
          p_custom_groups?: Json
          p_dividers: Json
          p_enabled_groups: Json
          p_enabled_modules: Json
          p_module_icon_colors?: Json
          p_module_order: Json
          p_module_parents?: Json
          p_org_id: string
        }
        Returns: Json
      }
      set_team_module_defaults: {
        Args: {
          p_custom_groups?: Json
          p_dividers: Json
          p_enabled_groups: Json
          p_enabled_modules: Json
          p_module_icon_colors?: Json
          p_module_order: Json
          p_module_parents?: Json
          p_team_id: string
        }
        Returns: Json
      }
      unassign_solidworks_license: {
        Args: { p_assignment_id: string }
        Returns: Json
      }
      unblock_user: { Args: { p_email: string }; Returns: Json }
      update_google_drive_settings: {
        Args: {
          p_client_id: string
          p_client_secret: string
          p_enabled: boolean
          p_inspection_template_folder_id?: string
          p_org_id: string
        }
        Returns: boolean
      }
      update_last_online: { Args: never; Returns: Json }
      update_org_branding: {
        Args: {
          p_contact_email?: string
          p_logo_storage_path?: string
          p_logo_url?: string
          p_org_id: string
          p_phone?: string
          p_website?: string
        }
        Returns: Json
      }
      update_schema_version: {
        Args: { new_description?: string; new_version: number }
        Returns: undefined
      }
      get_item_definition_settings: {
        Args: { p_org_id: string }
        Returns: Json
      }
      update_item_definition_settings: {
        Args: { p_org_id: string; p_settings: Json }
        Returns: boolean
      }
      update_serialization_settings_safe: {
        Args: { p_org_id: string; p_settings: Json }
        Returns: boolean
      }
      update_user_avatar: {
        Args: { p_avatar_storage_path?: string; p_custom_avatar_url?: string }
        Returns: Json
      }
      use_admin_recovery_code: {
        Args: { p_code: string; p_ip_address?: string }
        Returns: Json
      }
      user_has_permission: {
        Args: {
          p_action: Database['public']['Enums']['permission_action']
          p_resource: string
          p_user_id: string
          p_vault_id?: string
        }
        Returns: boolean
      }
      user_has_team_permission: {
        Args: {
          p_action: Database['public']['Enums']['permission_action']
          p_resource: string
          p_vault_id?: string
        }
        Returns: boolean
      }
      validate_share_link: {
        Args: { p_token: string }
        Returns: {
          error_message: string
          file_id: string
          file_version: number
          is_valid: boolean
          org_id: string
        }[]
      }
    }
    Enums: {
      action_type:
        | 'increment_revision'
        | 'set_variable'
        | 'clear_variable'
        | 'send_notification'
        | 'execute_task'
        | 'set_file_permission'
        | 'copy_file'
        | 'run_script'
      activity_action:
        | 'create'
        | 'update'
        | 'checkout'
        | 'checkin'
        | 'state_change'
        | 'revision_change'
        | 'delete'
        | 'restore'
        | 'move'
        | 'rename'
      address_type: 'billing' | 'shipping'
      approval_mode: 'any' | 'all' | 'majority'
      auto_trigger_type: 'timer' | 'condition_met' | 'all_approvals' | 'schedule'
      checklist_item_status: 'not_started' | 'in_progress' | 'complete' | 'blocked' | 'na'
      condition_type:
        | 'file_path'
        | 'file_extension'
        | 'variable'
        | 'revision'
        | 'category'
        | 'checkout_status'
        | 'user_role'
        | 'workflow_role'
        | 'file_owner'
        | 'custom_sql'
      deviation_status:
        | 'draft'
        | 'pending_approval'
        | 'approved'
        | 'rejected'
        | 'closed'
        | 'expired'
      eco_status: 'open' | 'in_progress' | 'completed' | 'cancelled'
      file_state: 'not_tracked' | 'wip' | 'in_review' | 'released' | 'obsolete'
      file_type: 'part' | 'assembly' | 'drawing' | 'pdf' | 'step' | 'other'
      gate_type: 'approval' | 'checklist' | 'condition'
      metadata_column_type: 'text' | 'number' | 'date' | 'boolean' | 'select'
      notification_recipient_type:
        | 'user'
        | 'role'
        | 'workflow_role'
        | 'file_owner'
        | 'file_creator'
        | 'checkout_user'
        | 'previous_state_user'
        | 'all_org'
      permission_action: 'view' | 'create' | 'edit' | 'delete' | 'admin'
      reference_type: 'component' | 'derived' | 'reference'
      release_file_type: 'step' | 'pdf' | 'dxf' | 'iges' | 'stl' | 'dwg' | 'dxf_flat'
      review_status: 'pending' | 'approved' | 'rejected' | 'cancelled' | 'kicked_back'
      reviewer_type: 'user' | 'role' | 'group' | 'workflow_role'
      revision_scheme: 'letter' | 'numeric'
      revision_scheme_type: 'numeric' | 'alpha_upper' | 'alpha_lower' | 'alphanumeric' | 'custom'
      rfq_status:
        | 'draft'
        | 'pending_files'
        | 'generating'
        | 'ready'
        | 'sent'
        | 'awaiting_quote'
        | 'quoted'
        | 'awarded'
        | 'cancelled'
        | 'completed'
      solidworks_license_type: 'standalone' | 'network'
      state_permission_type:
        | 'read_file'
        | 'write_file'
        | 'delete_file'
        | 'add_file'
        | 'rename_file'
        | 'change_state'
        | 'edit_metadata'
      state_shape: 'rectangle' | 'diamond' | 'hexagon' | 'ellipse'
      state_type: 'state' | 'gate'
      supplier_auth_method: 'email' | 'phone' | 'wechat'
      transition_arrow_head: 'none' | 'end' | 'start' | 'both'
      transition_line_style: 'solid' | 'dashed' | 'dotted'
      transition_path_type: 'straight' | 'spline' | 'elbow'
      user_role: 'admin' | 'engineer' | 'viewer'
      webhook_delivery_status: 'pending' | 'success' | 'failed' | 'retrying'
      webhook_event:
        | 'file.created'
        | 'file.updated'
        | 'file.deleted'
        | 'file.checked_in'
        | 'file.checked_out'
        | 'file.state_changed'
        | 'file.revision_changed'
        | 'eco.created'
        | 'eco.updated'
        | 'eco.completed'
        | 'review.requested'
        | 'review.approved'
        | 'review.rejected'
        | 'rfq.created'
        | 'rfq.sent'
        | 'rfq.quoted'
        | 'rfq.awarded'
        | 'supplier.created'
        | 'supplier.updated'
      workflow_state_type: 'initial' | 'intermediate' | 'final' | 'rejected'
      workflow_task_type:
        | 'convert_pdf'
        | 'convert_step'
        | 'convert_iges'
        | 'convert_edrawings'
        | 'convert_dxf'
        | 'custom_export'
        | 'run_script'
        | 'webhook'
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, 'public'>]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    ? (DefaultSchema['Tables'] & DefaultSchema['Views'])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema['Tables']
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema['Tables']
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema['Enums']
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums']
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums'][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums']
    ? DefaultSchema['Enums'][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema['CompositeTypes']
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes']
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes'][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema['CompositeTypes']
    ? DefaultSchema['CompositeTypes'][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      action_type: [
        'increment_revision',
        'set_variable',
        'clear_variable',
        'send_notification',
        'execute_task',
        'set_file_permission',
        'copy_file',
        'run_script',
      ],
      activity_action: [
        'create',
        'update',
        'checkout',
        'checkin',
        'state_change',
        'revision_change',
        'delete',
        'restore',
        'move',
        'rename',
      ],
      address_type: ['billing', 'shipping'],
      approval_mode: ['any', 'all', 'majority'],
      auto_trigger_type: ['timer', 'condition_met', 'all_approvals', 'schedule'],
      checklist_item_status: ['not_started', 'in_progress', 'complete', 'blocked', 'na'],
      condition_type: [
        'file_path',
        'file_extension',
        'variable',
        'revision',
        'category',
        'checkout_status',
        'user_role',
        'workflow_role',
        'file_owner',
        'custom_sql',
      ],
      deviation_status: ['draft', 'pending_approval', 'approved', 'rejected', 'closed', 'expired'],
      eco_status: ['open', 'in_progress', 'completed', 'cancelled'],
      file_state: ['not_tracked', 'wip', 'in_review', 'released', 'obsolete'],
      file_type: ['part', 'assembly', 'drawing', 'pdf', 'step', 'other'],
      gate_type: ['approval', 'checklist', 'condition'],
      metadata_column_type: ['text', 'number', 'date', 'boolean', 'select'],
      notification_recipient_type: [
        'user',
        'role',
        'workflow_role',
        'file_owner',
        'file_creator',
        'checkout_user',
        'previous_state_user',
        'all_org',
      ],
      permission_action: ['view', 'create', 'edit', 'delete', 'admin'],
      reference_type: ['component', 'derived', 'reference'],
      release_file_type: ['step', 'pdf', 'dxf', 'iges', 'stl', 'dwg', 'dxf_flat'],
      review_status: ['pending', 'approved', 'rejected', 'cancelled', 'kicked_back'],
      reviewer_type: ['user', 'role', 'group', 'workflow_role'],
      revision_scheme: ['letter', 'numeric'],
      revision_scheme_type: ['numeric', 'alpha_upper', 'alpha_lower', 'alphanumeric', 'custom'],
      rfq_status: [
        'draft',
        'pending_files',
        'generating',
        'ready',
        'sent',
        'awaiting_quote',
        'quoted',
        'awarded',
        'cancelled',
        'completed',
      ],
      solidworks_license_type: ['standalone', 'network'],
      state_permission_type: [
        'read_file',
        'write_file',
        'delete_file',
        'add_file',
        'rename_file',
        'change_state',
        'edit_metadata',
      ],
      state_shape: ['rectangle', 'diamond', 'hexagon', 'ellipse'],
      state_type: ['state', 'gate'],
      supplier_auth_method: ['email', 'phone', 'wechat'],
      transition_arrow_head: ['none', 'end', 'start', 'both'],
      transition_line_style: ['solid', 'dashed', 'dotted'],
      transition_path_type: ['straight', 'spline', 'elbow'],
      user_role: ['admin', 'engineer', 'viewer'],
      webhook_delivery_status: ['pending', 'success', 'failed', 'retrying'],
      webhook_event: [
        'file.created',
        'file.updated',
        'file.deleted',
        'file.checked_in',
        'file.checked_out',
        'file.state_changed',
        'file.revision_changed',
        'eco.created',
        'eco.updated',
        'eco.completed',
        'review.requested',
        'review.approved',
        'review.rejected',
        'rfq.created',
        'rfq.sent',
        'rfq.quoted',
        'rfq.awarded',
        'supplier.created',
        'supplier.updated',
      ],
      workflow_state_type: ['initial', 'intermediate', 'final', 'rejected'],
      workflow_task_type: [
        'convert_pdf',
        'convert_step',
        'convert_iges',
        'convert_edrawings',
        'convert_dxf',
        'custom_export',
        'run_script',
        'webhook',
      ],
    },
  },
} as const
